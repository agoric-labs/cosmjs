import { CosmosClient, Pen, SigningCosmosClient } from "@cosmjs/sdk38";
import { sleep } from "@cosmjs/utils";

import { debugAccount, logAccountsState, logSendJob } from "./debugging";
import { createPens } from "./profile";
import { TokenManager } from "./tokenmanager";
import { MinimalAccount, SendJob, TokenConfiguration } from "./types";

function isDefined<X>(value: X | undefined): value is X {
  return value !== undefined;
}

export class Faucet {
  public static async make(
    apiUrl: string,
    addressPrefix: string,
    config: TokenConfiguration,
    mnemonic: string,
    numberOfDistributors: number,
    logging = false,
  ): Promise<Faucet> {
    const pens = await createPens(mnemonic, addressPrefix, numberOfDistributors, logging);
    return new Faucet(apiUrl, addressPrefix, config, pens, logging);
  }

  public readonly addressPrefix: string;
  public readonly holderAddress: string;
  public readonly distributorAddresses: readonly string[];

  private readonly tokenConfig: TokenConfiguration;
  private readonly tokenManager: TokenManager;
  private readonly readOnlyClient: CosmosClient;
  private readonly clients: { [senderAddress: string]: SigningCosmosClient };
  private readonly logging: boolean;
  private creditCount = 0;

  private constructor(
    apiUrl: string,
    addressPrefix: string,
    config: TokenConfiguration,
    pens: readonly [string, Pen][],
    logging = false,
  ) {
    this.addressPrefix = addressPrefix;
    this.tokenConfig = config;
    this.tokenManager = new TokenManager(config);

    this.readOnlyClient = new CosmosClient(apiUrl);

    this.holderAddress = pens[0][0];
    this.distributorAddresses = pens.slice(1).map((pair) => pair[0]);

    // we need one client per sender
    const clients: { [senderAddress: string]: SigningCosmosClient } = {};
    for (const [senderAddress, pen] of pens) {
      clients[senderAddress] = new SigningCosmosClient(apiUrl, senderAddress, (signBytes) =>
        pen.sign(signBytes),
      );
    }
    this.clients = clients;
    this.logging = logging;
  }

  /**
   * Returns a list of ticker symbols of tokens owned by the the holder and configured in the faucet
   */
  public async availableTokens(): Promise<ReadonlyArray<string>> {
    const holderAccount = await this.readOnlyClient.getAccount(this.holderAddress);
    const balance = holderAccount ? holderAccount.balance : [];

    return balance
      .filter((b) => b.amount !== "0")
      .map((b) => this.tokenConfig.bankTokens.find((token) => token.denom == b.denom))
      .filter(isDefined)
      .map((token) => token.tickerSymbol);
  }

  /**
   * Creates and posts a send transaction. Then waits until the transaction is in a block.
   */
  public async send(job: SendJob): Promise<void> {
    await this.clients[job.sender].sendTokens(job.recipient, [job.amount], "Make love, not war");
  }

  /** Use one of the distributor accounts to send tokend to user */
  public async credit(recipient: string, tickerSymbol: string): Promise<void> {
    if (this.distributorAddresses.length === 0) throw new Error("No distributor account available");
    const sender = this.distributorAddresses[this.getCreditCount() % this.distributorAddresses.length];
    const job: SendJob = {
      sender: sender,
      recipient: recipient,
      amount: this.tokenManager.creditAmount(tickerSymbol),
    };
    if (this.logging) logSendJob(job, this.tokenConfig);
    await this.send(job);
  }

  public loadTokenTickers(): readonly string[] {
    return this.tokenConfig.bankTokens.map((token) => token.tickerSymbol);
  }

  public async loadAccounts(): Promise<ReadonlyArray<MinimalAccount>> {
    const addresses = [this.holderAddress, ...this.distributorAddresses];

    return Promise.all(
      addresses.map(
        async (address): Promise<MinimalAccount> => {
          const response = await this.readOnlyClient.getAccount(address);
          if (response) {
            return response;
          } else {
            return {
              address: address,
              balance: [],
            };
          }
        },
      ),
    );
  }

  public async refill(): Promise<void> {
    if (this.logging) {
      console.info(`Connected to network: ${this.readOnlyClient.getChainId()}`);
      console.info(`Tokens on network: ${this.loadTokenTickers().join(", ")}`);
    }

    const accounts = await this.loadAccounts();
    if (this.logging) logAccountsState(accounts, this.tokenConfig);
    const [_, ...distributorAccounts] = accounts;

    const availableTokens = await this.availableTokens();
    if (this.logging) console.info("Available tokens:", availableTokens);

    const jobs: SendJob[] = [];
    for (const tickerSymbol of availableTokens) {
      const refillDistibutors = distributorAccounts.filter((account) =>
        this.tokenManager.needsRefill(account, tickerSymbol),
      );

      if (this.logging) {
        console.info(`Refilling ${tickerSymbol} of:`);
        console.info(
          refillDistibutors.length
            ? refillDistibutors.map((r) => `  ${debugAccount(r, this.tokenConfig)}`).join("\n")
            : "  none",
        );
      }
      for (const refillDistibutor of refillDistibutors) {
        jobs.push({
          sender: this.holderAddress,
          recipient: refillDistibutor.address,
          amount: this.tokenManager.refillAmount(tickerSymbol),
        });
      }
    }
    if (jobs.length > 0) {
      for (const job of jobs) {
        if (this.logging) logSendJob(job, this.tokenConfig);
        await this.send(job);
        await sleep(75);
      }

      if (this.logging) {
        console.info("Done refilling accounts.");
        logAccountsState(await this.loadAccounts(), this.tokenConfig);
      }
    } else {
      if (this.logging) {
        console.info("Nothing to be done. Anyways, thanks for checking.");
      }
    }
  }

  /** returns an integer >= 0 that increments and is unique for this instance */
  private getCreditCount(): number {
    return this.creditCount++;
  }
}
