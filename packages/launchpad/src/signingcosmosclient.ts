/* eslint-disable @typescript-eslint/naming-convention */
import equals from "fast-deep-equal";

import { Coin } from "./coins";
import { Account, BroadcastTxResult, CosmosClient, GetSequenceResult } from "./cosmosclient";
import { makeSignDoc } from "./encoding";
import { buildFeeTable, FeeTable, GasLimits, GasPrice } from "./gas";
import { BroadcastMode } from "./lcdapi";
import { Msg, MsgSend } from "./msgs";
import { OfflineSigner } from "./signer";
import { makeStdTx, StdTx } from "./tx";
import { StdFee } from "./types";

/**
 * These fees are used by the higher level methods of SigningCosmosClient
 */
export interface CosmosFeeTable extends FeeTable {
  readonly send: StdFee;
}

const defaultGasPrice = GasPrice.fromString("0.025ucosm");
const defaultGasLimits: GasLimits<CosmosFeeTable> = { send: 80000 };

/** Use for testing only */
export interface PrivateSigningCosmosClient {
  readonly fees: CosmosFeeTable;
}

export class SigningCosmosClient extends CosmosClient {
  public readonly signerAddress: string;

  private readonly signer: OfflineSigner;
  private readonly fees: CosmosFeeTable;

  /**
   * Creates a new client with signing capability to interact with a Cosmos SDK blockchain. This is the bigger brother of CosmosClient.
   *
   * This instance does a lot of caching. In order to benefit from that you should try to use one instance
   * for the lifetime of your application. When switching backends, a new instance must be created.
   *
   * @param apiUrl The URL of a Cosmos SDK light client daemon API (sometimes called REST server or REST API)
   * @param signerAddress The address that will sign transactions using this instance. The `signer` must be able to sign with this address.
   * @param signer An implementation of OfflineSigner which can provide signatures for transactions, potentially requiring user input.
   * @param gasPrice The price paid per unit of gas
   * @param gasLimits Custom overrides for gas limits related to specific transaction types
   * @param broadcastMode Defines at which point of the transaction processing the broadcastTx method returns
   */
  public constructor(
    apiUrl: string,
    signerAddress: string,
    signer: OfflineSigner,
    gasPrice: GasPrice = defaultGasPrice,
    gasLimits: Partial<GasLimits<CosmosFeeTable>> = {},
    broadcastMode = BroadcastMode.Block,
  ) {
    super(apiUrl, broadcastMode);
    this.anyValidAddress = signerAddress;
    this.signerAddress = signerAddress;
    this.signer = signer;
    this.fees = buildFeeTable<CosmosFeeTable>(gasPrice, defaultGasLimits, gasLimits);
  }

  public async getSequence(address?: string): Promise<GetSequenceResult> {
    return super.getSequence(address || this.signerAddress);
  }

  public async getAccount(address?: string): Promise<Account | undefined> {
    return super.getAccount(address || this.signerAddress);
  }

  public async sendTokens(
    recipientAddress: string,
    transferAmount: readonly Coin[],
    memo = "",
  ): Promise<BroadcastTxResult> {
    const sendMsg: MsgSend = {
      type: "cosmos-sdk/MsgSend",
      value: {
        from_address: this.signerAddress,
        to_address: recipientAddress,
        amount: transferAmount,
      },
    };
    return this.signAndBroadcast([sendMsg], this.fees.send, memo);
  }

  /**
   * Gets account number and sequence from the API, creates a sign doc,
   * creates a single signature, assembles the signed transaction and broadcasts it.
   */
  public async signAndBroadcast(msgs: readonly Msg[], fee: StdFee, memo = ""): Promise<BroadcastTxResult> {
    const signedTx = await this.sign(msgs, fee, memo);
    return this.broadcastTx(signedTx);
  }

  /**
   * Gets account number and sequence from the API, creates a sign doc,
   * creates a single signature and assembles the signed transaction.
   */
  public async sign(msgs: readonly Msg[], fee: StdFee, memo = ""): Promise<StdTx> {
    const { accountNumber, sequence } = await this.getSequence();
    const chainId = await this.getChainId();
    const signDoc = makeSignDoc(msgs, fee, chainId, memo, accountNumber, sequence);
    const { signed, signature } = await this.signer.signAmino(this.signerAddress, signDoc);
    return makeStdTx(signed, signature);
  }

  /**
   * Gets account number and sequence from the API, creates a sign doc,
   * creates a single signature and appends it to the existing signatures.
   */
  public async appendSignature(signedTx: StdTx): Promise<StdTx> {
    const { msg: msgs, fee, memo } = signedTx;
    const { accountNumber, sequence } = await this.getSequence();
    const chainId = await this.getChainId();
    const signDoc = makeSignDoc(msgs, fee, chainId, memo, accountNumber, sequence);
    const { signed, signature: additionalSignature } = await this.signer.signAmino(
      this.signerAddress,
      signDoc,
    );
    if (!equals(signDoc, signed)) {
      throw new Error(
        "The signed document differs from the one of the original transaction. This is not allowed since the resulting transaction will be invalid.",
      );
    }
    return makeStdTx(signed, [...signedTx.signatures, additionalSignature]);
  }
}
