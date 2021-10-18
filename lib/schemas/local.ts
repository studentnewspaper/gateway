import { PruneSchema } from "@graphql-tools/wrap";
import { SubschemaConfig } from "@graphql-tools/delegate";
import { buildSchema } from "type-graphql";
import { ArticleResolver, ArticlesEdgeResolver } from "../article";
import { AuthorResolver } from "../author";
import { CategoryResolver, CategoryQueryArgs } from "../category";
import { ImageResolver } from "../image";

async function _getLocalSchema(): Promise<SubschemaConfig> {
  const localSchema = await buildSchema({
    resolvers: [
      ArticleResolver,
      AuthorResolver,
      CategoryResolver,
      ArticlesEdgeResolver,
      ImageResolver,
    ],
  });

  return {
    schema: localSchema,
    transforms: [new PruneSchema()],
    merge: {
      Category: {
        fieldName: "category",
        selectionSet: "{ wordpressTags }",
        args: ({ wordpressTags }): CategoryQueryArgs => ({ wordpressTags }),
      },
    },
  };
}

let cached: SubschemaConfig | null = null;

export async function getLocalSchema(): Promise<SubschemaConfig> {
  if (cached == null) {
    cached = await _getLocalSchema();
  }

  return cached;
}
