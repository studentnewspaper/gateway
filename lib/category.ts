import { Prisma, wp_term_relationships } from "@prisma/client";
import { Category, ArticlesEdge, Author } from "./types";
import { Resolver, Query, Arg, FieldResolver, Root } from "type-graphql";
import * as fs from "fs";
import * as yaml from "yaml";
import { client } from "./client";

@Resolver(Category)
export class CategoryResolver {
  @Query((returns) => [Category])
  categories(
    @Arg("include", () => [String], { nullable: true })
    include: string[] | null,
    @Arg("exclude", () => [String], { nullable: true }) exclude: string[] | null
  ): Category[] {
    return config.categories
      .map((category) => ({
        id: category.id,
        name: category.name,
        isSection: category.isSection ?? true,
      }))
      .filter((category) => {
        if (include != null && !include.includes(category.id)) return false;
        if (exclude != null && exclude.includes(category.id)) return false;
        return true;
      });
  }

  @Query((returns) => Category, { nullable: true })
  category(@Arg("id") id: string): Category | null {
    const categoryConfig = config.categories.find(
      (category) => category.id == id
    );
    if (categoryConfig == null) return null;

    // TODO: extract to function + merge with other resolver
    return {
      id: categoryConfig.id,
      name: categoryConfig.name,
      isSection: categoryConfig.isSection ?? true,
    };
  }

  @FieldResolver((returns) => ArticlesEdge)
  async articles(
    @Root() category: Category,
    @Arg("take", { defaultValue: 20 }) batchSize: number,
    @Arg("cursor", () => String, { nullable: true }) cursor: string | null
  ): Promise<ArticlesEdge> {
    const categoryConfig = getCategoryById(category.id);
    const edge = await objectsInCategory(
      categoryConfig,
      batchSize,
      cursor
    ).next();
    return edge.value;
  }
}

type CategoryConfig = {
  id: string;
  name: string;
  isSection?: boolean;
  wp: number[];
};

type Config = {
  categories: CategoryConfig[];
};

const configFile = fs.readFileSync("config.yml", "utf-8");
const config: Config = yaml.parse(configFile);

type ArticleCursor =
  Prisma.wp_term_relationshipsObject_idTerm_taxonomy_idCompoundUniqueInput;

type CategoryResult = {
  hasNextPage: boolean;
  lastCursor: string | null;
  nodes: number[];
};

export async function* objectsInCategory(
  category: CategoryConfig,
  batchSize = 20,
  firstCursor?: string | null
): AsyncGenerator<CategoryResult> {
  let cursor: ArticleCursor | null =
    firstCursor != null ? fromArticleCursorString(firstCursor) : null;

  while (true) {
    const results: wp_term_relationships[] =
      await client.wp_term_relationships.findMany({
        where: {
          term_taxonomy_id: { in: category.wp },
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

export function getCategoryById(id: string) {
  const category = Object.values(config.categories).find((x) => x.id == id);
  if (category == null) throw new Error(`Category ${id} not found`);
  return category;
}
