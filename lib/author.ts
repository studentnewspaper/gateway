import { Author, Article } from "./types";
import { hashAuthor, textOrNull } from "./utils";
import { Resolver, Query, Arg, FieldResolver, Root } from "type-graphql";
import * as fs from "fs";
import * as yaml from "yaml";
import { findArticles, whereArticleAuthorId } from "./article";
import { Prisma } from "@prisma/client";
import { client } from "./client";

@Resolver(Author)
export class AuthorResolver {
  @Query((returns) => Author, { nullable: true })
  async author(@Arg("slug") slug: string): Promise<Author | null> {
    return findAuthor(whereAuthorSlug(slug));
  }

  @FieldResolver((returns) => [Article])
  async articles(@Root() author: Author): Promise<Article[]> {
    const numericId = hashAuthor.decode(author.id)[0];
    return findArticles(whereArticleAuthorId(Number(numericId)));
  }

  @FieldResolver((returns) => Author, { nullable: true })
  async canonical(@Root() author: Author): Promise<Author | null> {
    const authorId = hashAuthor.decode(author.id)[0];
    const { canonicalId } = relatedAuthorIds(Number(authorId));
    if (canonicalId == authorId) return null;

    const canonicalAuthor = await findAuthor(whereAuthorId(canonicalId));
    if (canonicalAuthor == null)
      throw new Error(`Canonical author ${canonicalId} not found`);

    return canonicalAuthor;
  }
}

export async function findAuthor(
  where: Prisma.wp_usersWhereInput
): Promise<Author | null> {
  const result = await client.wp_users.findFirst({
    where,
    select: { ID: true, user_nicename: true, display_name: true },
  });

  if (result == null) return null;

  const id = Number(result.ID);
  const bio = await getAuthorBio(id);

  return {
    id: hashAuthor.encode(Number(result.ID)),
    slug: result.user_nicename,
    name: result.display_name,
    bio,
  };
}

export async function getAuthorBio(id: number): Promise<string | null> {
  const result = await client.wp_usermeta.findFirst({
    where: { user_id: id, meta_key: "description" },
    select: { meta_value: true },
  });
  if (result == null)
    throw new Error(`User ${id} not found, could not get bio`);

  let bio = result.meta_value?.trim();
  return textOrNull(bio);
}

export function whereAuthorId(id: number): Prisma.wp_usersWhereInput {
  return { ID: id };
}

export function whereAuthorSlug(slug: string): Prisma.wp_usersWhereInput {
  return { user_nicename: slug };
}

type AuthorMergeConfig = {
  from?: number[];
  to: number;
  include?: number[];
};

const mergeFile: { [key: string]: AuthorMergeConfig } = yaml.parse(
  fs.readFileSync("./merge.yml", "utf-8")
);
const mergeConfigs = Object.values(mergeFile);

export function dedupeAuthorId(id: number): number {
  return (
    mergeConfigs.find((config) => config.from?.includes(id) ?? false)?.to ?? id
  );
}

export function relatedAuthorIds(id: number): {
  canonicalId: number;
  otherIds: number[];
} {
  const config = mergeConfigs.find(
    (config) => (config.from?.includes(id) ?? false) || config.to == id
  );
  if (config == null) return { canonicalId: id, otherIds: [] };

  const canonicalId = config.to;
  const allIds = new Set([...(config.from ?? []), ...(config.include ?? [])]);
  allIds.delete(canonicalId);

  return { canonicalId, otherIds: [...allIds] };
}
