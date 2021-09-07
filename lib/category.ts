import { Prisma, wp_term_relationships } from "@prisma/client";
import { Category, ArticlesEdge } from "./types";
import {
  Resolver,
  Query,
  Arg,
  FieldResolver,
  Root,
  ArgsType,
  Field,
  Int,
  Args,
  ID,
} from "type-graphql";
import { client } from "./client";
@ArgsType()
export class CategoryQueryArgs {
  @Field((type) => [Number])
  wordpressTags: number[];
}

@Resolver(Category)
export class CategoryResolver {
  @Query((returns) => Category)
  category(@Args() args: CategoryQueryArgs): Category {
    return { wordpressTags: args.wordpressTags };
  }

  @FieldResolver((returns) => ArticlesEdge)
  async articles(
    @Root() category: Category,
    @Arg("take", () => Int, { defaultValue: 20 }) batchSize: number,
    @Arg("cursor", () => String, { nullable: true }) cursor: string | null
  ): Promise<ArticlesEdge> {
    const edge = await objectsInCategory(
      category.wordpressTags!,
      batchSize,
      cursor
    ).next();
    return edge.value;
  }
}

type ArticleCursor =
  Prisma.wp_term_relationshipsObject_idTerm_taxonomy_idCompoundUniqueInput;

type CategoryResult = {
  hasNextPage: boolean;
  lastCursor: string | null;
  nodes: number[];
};

export async function* objectsInCategory(
  tags: number[],
  batchSize = 20,
  firstCursor?: string | null
): AsyncGenerator<CategoryResult> {
  let cursor: ArticleCursor | null =
    firstCursor != null ? fromArticleCursorString(firstCursor) : null;

  while (true) {
    const results: wp_term_relationships[] =
      await client.wp_term_relationships.findMany({
        where: {
          term_taxonomy_id: { in: tags },
          object: {
            post_status: "publish",
            post_type: "post",
            post_date_gmt: { lte: new Date() },
          },
        },
        orderBy: [{ object_id: "desc" }, { term_taxonomy_id: "asc" }],
        cursor: (cursor && { object_id_term_taxonomy_id: cursor }) ?? undefined,
        skip: cursor != null ? 1 : 0,
        take: batchSize + 1,
        distinct: ["object_id"],
      });

    if (results.length == 0) {
      return {
        lastCursor: null,
        nodes: [],
        hasNextPage: false,
      };
    }

    const hasNextPage = results.length == batchSize + 1;
    const batch = results.slice(0, batchSize);
    const lastItem = batch[batch.length - 1];
    cursor = {
      object_id: lastItem.object_id,
      term_taxonomy_id: lastItem.term_taxonomy_id,
    };

    const result = {
      lastCursor: toArticleCursorSting(cursor),
      nodes: batch.map((x) => Number(x.object_id)),
      hasNextPage,
    };

    if (hasNextPage) {
      yield result;
    } else {
      return result;
    }
  }
}

export function toArticleCursorSting(cursor: ArticleCursor): string {
  return [cursor.object_id, cursor.term_taxonomy_id]
    .map((part) => JSON.stringify(Number(part)))
    .map((part) => encodeURIComponent(part))
    .join("//");
}

export function fromArticleCursorString(str: string): ArticleCursor {
  const [object_id, term_taxonomy_id] = str
    .split("//")
    .map((part) => decodeURIComponent(part))
    .map((part) => JSON.parse(part));

  return {
    object_id,
    term_taxonomy_id,
  };
}
