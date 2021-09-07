import "reflect-metadata";
import { buildSchema } from "type-graphql";
import { ApolloServer } from "apollo-server";
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

const requiredEnvs = ["ORION_URL", "ORION_TOKEN", "DATABASE_URL"];
for (const env of requiredEnvs) {
  if (typeof env != "string") {
    throw new Error(`Required ${env} environment variable not found`);
  }
}

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
    plugins: [ApolloServerPluginInlineTrace()],
  });

  const port = process.env.PORT || 8076;
  const { url } = await server.listen(port);
  console.log(`Server listening at ${url}`);
}

main().catch((err) => {
  throw err;
});
