import { Effect, Schema } from "effect";
import * as Component from "../Component.js";
import * as Route from "../Route.js";
import * as ServerRoute from "../ServerRoute.js";

const App = Route.paramsSchema(Schema.Struct({ userId: Schema.String }))(
  Route.path("/users/:userId")(Component.from<{}>(() => null)),
);

const SaveUser = ServerRoute.action({ key: "save-user" }).pipe(
  ServerRoute.method("POST"),
  ServerRoute.path(ServerRoute.generatedPath("save-user")),
  ServerRoute.form(Schema.Struct({ id: Schema.String, name: Schema.String })),
  ServerRoute.handle(({ form }) => Effect.succeed({ id: form.id, name: form.name })),
);

const GetUser = ServerRoute.json({ key: "get-user" }).pipe(
  ServerRoute.method("GET"),
  ServerRoute.path("/api/users/:userId"),
  ServerRoute.params(Schema.Struct({ userId: Schema.String })),
  ServerRoute.response(Schema.Struct({ id: Schema.String, name: Schema.String })),
  ServerRoute.handle(({ params }) => Effect.succeed({ id: params.userId, name: "Alice" })),
);

const UpdateUser = ServerRoute.json({ key: "update-user" }).pipe(
  ServerRoute.method("POST"),
  ServerRoute.path("/api/users"),
  ServerRoute.body(Schema.Struct({ id: Schema.String, name: Schema.String })),
  ServerRoute.response(Schema.Struct({ ok: Schema.Boolean, id: Schema.String })),
  ServerRoute.handle(({ body }) => Effect.succeed({ ok: true as const, id: body.id })),
);

const SearchUsers = ServerRoute.json({ key: "search-users" }).pipe(
  ServerRoute.method("GET"),
  ServerRoute.path("/search"),
  ServerRoute.query(Schema.Struct({ q: Schema.String })),
  ServerRoute.headers(Schema.Struct({ "x-request-id": Schema.String })),
  ServerRoute.cookies(Schema.Struct({ session: Schema.String })),
  ServerRoute.response(Schema.Struct({ ok: Schema.Boolean })),
  ServerRoute.handle(({ query, headers, cookies }) =>
    Effect.succeed({ ok: query.q.length > 0 && headers["x-request-id"].length > 0 && cookies.session.length > 0 })),
);

const Document = ServerRoute.document(App).pipe(
  ServerRoute.method("GET"),
  ServerRoute.path("/users/*"),
  ServerRoute.documentRenderer({ shell: "html" }),
);

type SaveUserForm = ServerRoute.FormOf<typeof SaveUser>;
type GetUserParams = ServerRoute.ParamsOf<typeof GetUser>;
type GetUserResponse = ServerRoute.ResponseOf<typeof GetUser>;
type UpdateUserBody = ServerRoute.BodyOf<typeof UpdateUser>;
type SearchUsersQuery = ServerRoute.QueryOf<typeof SearchUsers>;
type SearchUsersHeaders = ServerRoute.HeadersOf<typeof SearchUsers>;
type SearchUsersCookies = ServerRoute.CookiesOf<typeof SearchUsers>;

declare const saveUserForm: SaveUserForm;
declare const getUserParams: GetUserParams;
declare const getUserResponse: GetUserResponse;
declare const updateUserBody: UpdateUserBody;
declare const searchUsersQuery: SearchUsersQuery;
declare const searchUsersHeaders: SearchUsersHeaders;
declare const searchUsersCookies: SearchUsersCookies;

void saveUserForm;
void getUserParams;
void getUserResponse;
void updateUserBody;
void searchUsersQuery;
void searchUsersHeaders;
void searchUsersCookies;
void ServerRoute.nodes(ServerRoute.define(SaveUser, GetUser));
void ServerRoute.byKey(ServerRoute.define(SaveUser, GetUser), "save-user");
void ServerRoute.identity(SaveUser);
void ServerRoute.validate(ServerRoute.define(SaveUser, GetUser));
void Document;
