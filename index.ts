import "reflect-metadata";
import { buildSchema } from "type-graphql";
import { ApolloServer } from "apollo-server";
import { ApolloServerPluginInlineTrace } from "apollo-server-core";
import { ArticleResolver, ArticlesEdgeResolver } from "./lib/article";
import { AuthorResolver } from "./lib/author";
import { CategoryResolver } from "./lib/category";
import { ImageResolver } from "./lib/image";
import { init as prismaInit } from "./lib/client";

async function main() {
  await prismaInit();

  const schema = await buildSchema({
    resolvers: [
      ArticleResolver,
      AuthorResolver,
      CategoryResolver,
      ArticlesEdgeResolver,
      ImageResolver,
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
