import * as AtomRpc from "../AtomRpc.js";
import * as AtomHttpApi from "../AtomHttpApi.js";
import type { ActionHandle } from "../Atom.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;

type RpcDefs = {
  readonly getUser: {
    readonly payload: { readonly id: string };
    readonly success: { readonly id: string; readonly name: string };
    readonly error: { readonly _tag: "NotFound" };
  };
};

declare const rpcClient: AtomRpc.AtomRpcClient<RpcDefs, never>;
const rpcAction = rpcClient.action("getUser");
type RpcActionSuccess = typeof rpcAction extends ActionHandle<any, any, infer A> ? A : never;
type _RpcActionSuccess = Expect<Equal<RpcActionSuccess, { readonly id: string; readonly name: string }>>;

type HttpDefs = {
  readonly users: {
    readonly create: {
      readonly request: { readonly name: string };
      readonly success: { readonly id: string };
      readonly error: { readonly _tag: "ValidationError" };
    };
  };
};

declare const httpClient: AtomHttpApi.AtomHttpApiClient<HttpDefs, never>;
const httpAction = httpClient.action("users", "create");
type HttpActionSuccess = typeof httpAction extends ActionHandle<any, any, infer A> ? A : never;
type _HttpActionSuccess = Expect<Equal<HttpActionSuccess, { readonly id: string }>>;
