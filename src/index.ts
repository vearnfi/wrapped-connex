/// <reference path="../node_modules/@vechain/connex-types/index.d.ts" />

import { BigNumber } from "bignumber.js";

export type AbiType =
  | "function"
  | "constructor"
  | "event"
  | "fallback"
  | "receive";

export type StateMutabilityType = "pure" | "view" | "nonpayable" | "payable";

export type AbiItem = {
  anonymous?: boolean;
  constant?: boolean;
  inputs?: AbiInput[];
  name?: string;
  outputs?: AbiOutput[];
  payable?: boolean;
  stateMutability?: StateMutabilityType;
  type: AbiType;
  gas?: number;
};

export type AbiInput = {
  name: string;
  type: string;
  indexed?: boolean;
  components?: AbiInput[];
  internalType?: string;
};

export type AbiOutput = {
  name: string;
  type: string;
  components?: AbiOutput[];
  internalType?: string;
};

export type Balance = {
  vet: BigNumber;
  vtho: BigNumber;
};

/**
 * Client side self-signed certificate
 */
export interface Certificate {
  purpose: string;
  payload: {
    type: string;
    content: string;
  };
  domain: string;
  timestamp: number;
  signer: string;
  signature?: string;
}

export type SignTxArgs = {
  clauses: Connex.VM.Clause[];
  signer: string;
  gas?: number;
  delegate?: string;
  comment?: string;
}

export type Address = `0x${string}`;

export type Callback = (
  events: Connex.Thor.Filter.Row<"event", Connex.Thor.Account.WithDecoded>[],
) => Promise<void>;

export type RawEvent = Connex.Thor.Filter.Row<
  "event",
  Connex.Thor.Account.WithDecoded
>;

export type Filter = Connex.Thor.Filter<
  "event",
  Connex.Thor.Account.WithDecoded
>;

export type Contract = {
  methods: {
    constant: Record<string, (...args: any[]) => Promise<any>>;
    signed: Record<
      string,
      (
        ...args: any[]
      ) => (comment?: string) => Promise<Connex.Vendor.TxResponse>
    >;
    clause: Record<string, (...args: any[]) => Connex.VM.Clause>;
  };
  events: Record<string, Connex.Thor.Account.Event>;
  getAddress: () => Address;
};

export type WrappedConnex = Readonly<{
  getContract: (abi: AbiItem[], address: Address) => Contract;
  signCert: (message: Connex.Vendor.CertMessage) => Promise<Certificate>;
  signTx: (args: SignTxArgs) => Promise<Connex.Vendor.TxResponse>;
  getTicker: () => Connex.Thor.Ticker;
  waitForReceipt: (
    txId: string,
    iterations?: number,
  ) => Promise<Connex.Thor.Transaction.Receipt>;
  getCurrentBlock: () => Promise<Connex.Thor.Block | null>;
  getTransaction: (txId: string) => Promise<Connex.Thor.Transaction | null>;
  fetchBalance: (account: string) => Promise<Balance>;
  fetchEvents: (
    filter: Filter,
    callback: Callback,
    limit?: number,
  ) => Promise<void>;
}>;

/**
 * Factory function to build a wrapper around the connex library.
 * @param {Connex} connex Instance of the Connex library.
 */
export function wrapConnex(connex: Connex): WrappedConnex {
  return Object.freeze({
    getContract,
    signCert,
    signTx,
    getTicker,
    waitForReceipt,
    getCurrentBlock,
    getTransaction,
    fetchBalance,
    fetchEvents,
  });

  /**
   * Implements constant method.
   * @param {Address} address Smart contract address.
   * @param {AbiItem} method ABI method.
   * @return {*} Method
   */
  function defineConstant(
    address: Address,
    method: AbiItem,
  ): (...args: any[]) => Promise<Record<string | number, any>> {
    return async (...args: any[]) => {
      const res = await connex.thor
        .account(address)
        .method(method)
        .call(...args);

      return res.decoded;
    };
  }

  /**
   * Implements signed method.
   * @param {Address} address Smart contract address.
   * @param {AbiItem} method ABI method.
   * @return {*} Method
   */
  function defineSignedRequest(
    address: Address,
    method: AbiItem,
  ): (
    ...args: any[]
  ) => (comment?: string) => Promise<Connex.Vendor.TxResponse> {
    return (...args: any[]) =>
      async (comment?: string) => {
        const clause = connex.thor
          .account(address)
          .method(method)
          .asClause(...args);

        if (comment != null) {
          return connex.vendor.sign("tx", [clause]).comment(comment).request();
        }

        return connex.vendor.sign("tx", [clause]).request();
      };
  }

  /**
   * Defines method clause.
   * @param {Address} address Smart contract address.
   * @param {AbiItem} method ABI method.
   * @return {*} Method
   */
  function defineClause(
    address: Address,
    method: AbiItem,
  ): (...args: any[]) => Connex.VM.Clause {
    return (...args: any[]) => {
      return connex.thor
        .account(address)
        .method(method)
        .asClause(...args);
    };
  }

  /**
   * Creates an interface to interact with a smart contract methods
   * deployed at the given address.
   * @param {AbiItem[]} abi Smart contract's ABI.
   * @param {Address} address Smart contract's address.
   * @return {Contract} Contract object.
   */
  function getContract(abi: AbiItem[], address: Address): Contract {
    const contract: Contract = {
      methods: { constant: {}, signed: {}, clause: {} },
      events: {},
      getAddress: () => address,
    };

    for (const item of abi) {
      if (item.name != null && item.type === "function") {
        if (item.stateMutability === "view") {
          contract.methods.constant[item.name] = defineConstant(address, item);
        } else {
          contract.methods.signed[item.name] = defineSignedRequest(
            address,
            item,
          );
          contract.methods.clause[item.name] = defineClause(address, item);
        }
      } else if (item.name != null && item.type === "event") {
        contract.events[item.name] = connex.thor.account(address).event(item);
      }
    }

    return contract;
  }

  /**
   * Sign certificate to prove account's ownership.
   * @param {string} message Message to be displayed when signing the certificate.
   * @return Signed certificate.
   */
  async function signCert(
    message: Connex.Vendor.CertMessage,
  ): Promise<Certificate> {
    const certResponse = await connex.vendor
      .sign("cert", message)
      // .link(window.location.host)
      .request();

    const cert: Certificate = {
      purpose: message.purpose,
      payload: message.payload,
      domain: certResponse.annex.domain,
      timestamp: certResponse.annex.timestamp,
      signer: certResponse.annex.signer,
      signature: certResponse.signature,
    };

    return cert;
  }

  /**
   * Requests a signature for a transaction made of a given set of clauses.
   * @param {Connex.VM.Clause[]} clauses Clauses array.
   * @param {string} signer Signer address.
   * @param {string} comment Signature comment.
   * @return {Promise<Connex.Vendor.TxResponse>} Transaction response.
   */
  async function signTx({
    clauses,
    signer,
    gas,
    delegate,
    comment = "Sign transaction",
  }: SignTxArgs): Promise<Connex.Vendor.TxResponse> {
    let tx = connex.vendor.sign("tx", clauses);

    if (signer != null) {
        tx = tx.signer(signer);
    }

    if (gas != null) {
        tx = tx.gas(gas);
    }

    if (delegate != null) {
        tx = tx.delegate(delegate);
    }

    // .link("https://connex.vecha.in/{txid}") // User will be back to the app by the url https://connex.vecha.in/0xffff....
    return tx.comment(comment).request();
  }

  /**
   * Return thor ticker to track when new blocks are added to the chain.
   * @return {Connex.Thor.Ticker}
   */
  function getTicker(): Connex.Thor.Ticker {
    return connex.thor.ticker();
  }

  /**
   * Waits for the transaction to be confirmed.
   * @param {string} txId Transaction ID.
   * @param {number} iterations Maximum number of blocks to wait for
   * transaction confirmation before throwing.
   * @return {Promise<Connex.Thor.Transaction.Receipt>} Transaction receipt.
   * @throws When transaction not found or reverted.
   */
  async function waitForReceipt(
    txId: string,
    iterations = 5,
  ): Promise<Connex.Thor.Transaction.Receipt> {
    const ticker = getTicker();

    for (let i = 0; ; i++) {
      if (i >= iterations) {
        throw new Error("Transaction not found.");
      }

      await ticker.next();

      const receipt = await connex.thor.transaction(txId).getReceipt();

      if (receipt?.reverted) {
        throw new Error("The transaction has been reverted.");
      }

      if (receipt) {
        return receipt;
      }
    }
  }

  /**
   * Return current block.
   * @return {Promise<Connex.Thor.Block | null>} Current block.
   */
  async function getCurrentBlock(): Promise<Connex.Thor.Block | null> {
    return connex.thor.block().get();
  }

  /**
   * Return transaction associated to the given transaction id.
   * @param {string} txId Transaction id.
   * @return {Promise<Connex.Thor.Transaction>} Transaction.
   */
  async function getTransaction(
    txId: string,
  ): Promise<Connex.Thor.Transaction | null> {
    return connex.thor.transaction(txId).get();
  }

  /**
   * Fetch VET and VTHO account balance.
   * @param {string} account Account to be checked.
   * @return {Balance} VET and VTHO account balance in wei.
   */
  async function fetchBalance(account: string): Promise<Balance> {
    const { balance, energy } = await connex.thor.account(account).get();

    return {
      vet: new BigNumber(balance),
      vtho: new BigNumber(energy),
    };
  }

  /**
   * Fetch events in batches by applying the given filter.
   * Pass resulting events up via callback.
   * @param {Filter} filter Filter.
   * @param {Callback} callback Callback function to handle events.
   * @param {number} limit Limit / batch size.
   */
  async function fetchEvents(
    filter: Filter,
    callback: Callback,
    limit: number = 20,
  ): Promise<void> {
    let offset = 0;

    for (;;) {
      const events = await filter.apply(offset, limit);

      if (events.length === 0) break;

      await callback(events);

      offset += limit;
    }
  }
}
