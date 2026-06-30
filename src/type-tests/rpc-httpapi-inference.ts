import * as AtomRpc from "../AtomRpc.js";
import * as AtomHttpApi from "../AtomHttpApi.js";
import type { ActionErrorOf, ActionInputOf, ActionSuccessOf } from "../Atom.js";

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
type RpcActionSuccess = ActionSuccessOf<typeof rpcAction>;
type _RpcActionSuccess = Expect<Equal<RpcActionSuccess, { readonly id: string; readonly name: string }>>;
type _RpcActionInput = Expect<Equal<ActionInputOf<typeof rpcAction>, { readonly id: string }>>;
type _RpcActionError = Expect<Equal<ActionErrorOf<typeof rpcAction>, { readonly _tag: "NotFound" }>>;

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
type HttpActionSuccess = ActionSuccessOf<typeof httpAction>;
type _HttpActionSuccess = Expect<Equal<HttpActionSuccess, { readonly id: string }>>;
type _HttpActionInput = Expect<Equal<ActionInputOf<typeof httpAction>, { readonly name: string }>>;
type _HttpActionError = Expect<Equal<ActionErrorOf<typeof httpAction>, { readonly _tag: "ValidationError" }>>;
