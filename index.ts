import "reflect-metadata";
import { buildSchema } from "type-graphql";
import { ApolloServer, ApolloError } from "apollo-server";
import { ApolloServerPluginInlineTrace } from "apollo-server-core";
import { ArticleResolver, ArticlesEdgeResolver } from "./lib/article";
import { AuthorResolver } from "./lib/author";
import { CategoryQueryArgs, CategoryResolver } from "./lib/category";
import { ImageResolver } from "./lib/image";
import { init as prismaInit } from "./lib/client";
import { stitchSchemas } from "@graphql-tools/stitch";
import {
  introspectSchema,
  PruneSchema,
  RenameInputObjectFields,
  RenameInterfaceFields,
  RenameObjectFields,
  RenameRootFields,
  RenameTypes,
} from "@graphql-tools/wrap";
import { ExecutionRequest } from "@graphql-tools/utils";
import { fetch } from "cross-fetch";
import { print } from "graphql";
import camelcase from "camelcase";
import { ApolloServerPlugin } from "apollo-server-plugin-base";
import * as Sentry from "@sentry/node";

const requiredEnvs = ["ORION_URL", "ORION_TOKEN", "DATABASE_URL"];
for (const env of requiredEnvs) {
  if (typeof env != "string") {
    throw new Error(`Required ${env} environment variable not found`);
  }
}

const dsn = process.env.SENTRY_DSN;
const isProduction = process.env.NODE_ENV == "production";

Sentry.init({
  dsn,
  enabled: isProduction && dsn != null,
});

async function orionExecutor({ document, variables }: ExecutionRequest) {
  const query = print(document);
  const fetchResult = await fetch(process.env.ORION_URL!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ORION_TOKEN!}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  return fetchResult.json();
}

const ErrorPlugin: ApolloServerPlugin = {
  requestDidStart: async (ctx) => {
    return {
      didEncounterErrors: async (ctx) => {
        // Could not parse request, ignore
        if (ctx.operation == null) return;

        for (const err of ctx.errors) {
          if (err instanceof ApolloError) {
            continue;
          }

          Sentry.withScope((scope) => {
            // Annotate whether failing operation was query/mutation/subscription
            scope.setTag("kind", ctx.operation?.operation);
            scope.setExtra("query", ctx.request.query);
            scope.setExtra("variables", ctx.request.variables);
            if (err.path) {
              scope.addBreadcrumb({
                category: "query-path",
                message: err.path.join(" > "),
                level: Sentry.Severity.Debug,
              });
            }
            Sentry.captureException(err);
          });
        }
      },
    };
  },
};

async function main() {
  await prismaInit();

  const localSchema = await buildSchema({
    resolvers: [
      ArticleResolver,
      AuthorResolver,
      CategoryResolver,
      ArticlesEdgeResolver,
      ImageResolver,
    ],
  });

  const schema = stitchSchemas({
    subschemas: [
      {
        schema: localSchema,
        transforms: [new PruneSchema()],
        merge: {
          Category: {
            fieldName: "category",
            selectionSet: "{ wordpressTags }",
            args: ({ wordpressTags }): CategoryQueryArgs => ({ wordpressTags }),
          },
        },
      },
      {
        schema: await introspectSchema(orionExecutor),
        executor: orionExecutor,
        // merge: {
        //   Category: {
        //     selectionSet: "{ id }",
        //     args: ({ id }) => ({ id }),
        //   },
        // },
        transforms: [
          new RenameRootFields((op, name) => camelcase(name)),
          new RenameObjectFields((op, name) => camelcase(name)),
          new RenameInputObjectFields((op, name) => camelcase(name)),
          new RenameInterfaceFields((op, name) => camelcase(name)),
          new RenameTypes((name) => {
            name = camelcase(name, { pascalCase: true });
            name = name.replaceAll("Categories", "Category");
            return name;
          }),
        ],
      },
    ],
  });

  const server = new ApolloServer({
    schema,
    plugins: [ApolloServerPluginInlineTrace(), ErrorPlugin],
  });

  const port = process.env.PORT || 8076;
  const { url } = await server.listen(port);
  console.log(`Server listening at ${url}`);
}

main().catch((err) => {
  console.error(err);
  throw err;
});
