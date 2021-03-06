/* eslint-disable @typescript-eslint/camelcase */
import { Message } from "protobufjs";

import { cosmosField, cosmosMessage } from "./decorator";
import { Registry } from "./registry";

describe("registry magic demo", () => {
  it("works with a custom msg", () => {
    const nestedTypeUrl = "/demo.MsgNestedMagic";
    const typeUrl = "/demo.MsgMagic";
    const myRegistry = new Registry();

    @cosmosMessage(myRegistry, nestedTypeUrl)
    class MsgNestedMagic extends Message<{}> {
      @cosmosField.string(1)
      public readonly foo?: string;
    }

    @cosmosMessage(myRegistry, typeUrl)
    class MsgMagic extends Message<{}> {
      @cosmosField.boolean(1)
      public readonly booleanDemo?: boolean;

      @cosmosField.string(2)
      public readonly stringDemo?: string;

      @cosmosField.bytes(3)
      public readonly bytesDemo?: Uint8Array;

      @cosmosField.int64(4)
      public readonly int64Demo?: number;

      @cosmosField.uint64(5)
      public readonly uint64Demo?: number;

      @cosmosField.repeatedString(6)
      public readonly listDemo?: readonly string[];

      @cosmosField.message(7, MsgNestedMagic)
      public readonly nestedDemo?: MsgNestedMagic;
    }

    const msgNestedDemoFields = {
      foo: "bar",
    };
    const msgDemoFields = {
      booleanDemo: true,
      stringDemo: "example text",
      bytesDemo: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
      int64Demo: -123,
      uint64Demo: 123,
      listDemo: ["this", "is", "a", "list"],
      nestedDemo: msgNestedDemoFields,
    };
    const txBodyFields = {
      messages: [{ typeUrl: typeUrl, value: msgDemoFields }],
      memo: "Some memo",
      timeoutHeight: 9999,
      extensionOptions: [],
    };
    const txBodyBytes = myRegistry.encode({
      typeUrl: "/cosmos.tx.TxBody",
      value: txBodyFields,
    });

    const txBodyDecoded = myRegistry.decode({
      typeUrl: "/cosmos.tx.TxBody",
      value: txBodyBytes,
    });
    expect(txBodyDecoded.memo).toEqual(txBodyFields.memo);
    // int64Demo and uint64Demo decode to Long in Node
    expect(Number(txBodyDecoded.timeoutHeight)).toEqual(txBodyFields.timeoutHeight);
    expect(txBodyDecoded.extensionOptions).toEqual(txBodyFields.extensionOptions);

    const msgDemoDecoded = txBodyDecoded.messages[0] as MsgMagic;
    expect(msgDemoDecoded).toBeInstanceOf(MsgMagic);
    expect(msgDemoDecoded.booleanDemo).toEqual(msgDemoFields.booleanDemo);
    expect(msgDemoDecoded.stringDemo).toEqual(msgDemoFields.stringDemo);
    expect(msgDemoDecoded.bytesDemo).toEqual(msgDemoFields.bytesDemo);
    // int64Demo and uint64Demo decode to Long in Node
    expect(Number(msgDemoDecoded.int64Demo)).toEqual(msgDemoFields.int64Demo);
    expect(Number(msgDemoDecoded.uint64Demo)).toEqual(msgDemoFields.uint64Demo);
    expect(msgDemoDecoded.listDemo).toEqual(msgDemoFields.listDemo);

    expect(msgDemoDecoded.nestedDemo).toBeInstanceOf(MsgNestedMagic);
    expect(msgDemoDecoded.nestedDemo!.foo).toEqual(msgDemoFields.nestedDemo.foo);
  });
});
