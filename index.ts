import "reflect-metadata";
import { Prisma, PrismaClient, wp_term_relationships } from "@prisma/client";
import IdHasher from "hashids";
import {
  Arg,
  buildSchema,
  Field,
  FieldResolver,
  ID,
  ObjectType,
  Query,
  Resolver,
  Root,
} from "type-graphql";
import { ApolloServer } from "apollo-server";
import yaml from "yaml";
import fs from "fs";
import { ApolloServerPluginInlineTrace } from "apollo-server-core";
import { cleanHtml } from "./cleaner";

const hashAuthor = new IdHasher("author", 10);
const hashArticle = new IdHasher("article", 10);
const client = new PrismaClient({
  // log: ["query", "info", "error", "warn"]
});

@ObjectType()
class Article {
  @Field((type) => ID)
  id: string;
  @Field()
  slug: string;
  @Field()
  published: Date;
  @Field()
  updated: Date;
  @Field()
  title: string;
  @Field()
  content: string;

  authorId: string;
}

@Resolver(Article)
class ArticleResolver {
  @Query((returns) => Article, { nullable: true })
  async article(@Arg("slug") slug: string): Promise<Article | null> {
    const result = await findArticle(whereArticleSlug(slug));
    return result;
  }

  @FieldResolver((returns) => Author)
  async author(@Root() article: Article): Promise<Author> {
    const authorId = hashAuthor.decode(article.authorId)[0];
    const result = await findAuthor(whereAuthorId(Number(authorId)));
    if (result == null)
      throw new Error(`User ID ${article.authorId} not found`);
    return result;
  }

  @FieldResolver((returns) => Image, { nullable: true })
  async featuredImage(@Root() article: Article): Promise<Image | null> {
    const id = hashArticle.decode(article.id)[0];
    const image = await getFeaturedImage(Number(id));
    return image;
  }
}

@ObjectType()
class Author {
  @Field((type) => ID)
  id: string;
  @Field()
  slug: string;
  @Field()
  name: string;
  @Field(() => String, { nullable: true })
  bio: string | null;
}

@Resolver(Author)
class AuthorResolver {
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

@ObjectType()
class Category {
  @Field((type) => ID)
  id: string;

  @Field()
  name: string;

  @Field({
    description:
      "Non-section categories are meta-groupings of content. For instance, the featured category is not a section - it aggregates from other sections instead.",
  })
  isSection: boolean;
}

@ObjectType()
class ArticlesEdge {
  @Field()
  hasNextPage: boolean;
  @Field()
  lastCursor: string;

  nodes: number[];
}

function isTruthy<T>(x: T | null | undefined): x is T {
  return x != null;
}

@Resolver(ArticlesEdge)
class ArticlesEdgeResolver {
  @FieldResolver((returns) => [Article])
  async nodes(@Root() root: ArticlesEdge): Promise<Article[]> {
    const articles = await findArticles(whereArticleIdIn(root.nodes));
    const orderedArticles = root.nodes
      .map((id) =>
        articles.find((article) => hashArticle.decode(article.id)[0] == id)
      )
      .filter(isTruthy);
    return orderedArticles;
  }
}

@Resolver(Category)
class CategoryResolver {
  @Query((returns) => [Category])
  categories(): Category[] {
    return config.categories.map((category) => ({
      id: category.id,
      name: category.name,
      isSection: category.isSection ?? true,
    }));
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

async function findAuthor(
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

async function getAuthorBio(id: number): Promise<string | null> {
  const result = await client.wp_usermeta.findFirst({
    where: { user_id: id, meta_key: "description" },
    select: { meta_value: true },
  });
  if (result == null)
    throw new Error(`User ${id} not found, could not get bio`);

  let bio = result.meta_value?.trim();
  return textOrNull(bio);
}

function whereAuthorId(id: number): Prisma.wp_usersWhereInput {
  return { ID: id };
}

function whereAuthorSlug(slug: string): Prisma.wp_usersWhereInput {
  return { user_nicename: slug };
}

async function findArticles(
  where: Prisma.wp_postsWhereInput
): Promise<Article[]> {
  const results = await client.wp_posts.findMany({
    where,
    orderBy: {
      post_date_gmt: "desc",
    },
    select: {
      ID: true,
      post_name: true,
      post_date_gmt: true,
      post_modified_gmt: true,
      post_title: true,
      post_content: true,
      post_author: true,
    },
  });

  return results.map(conformArticle);
}

async function findArticle(
  where: Prisma.wp_postsWhereInput
): Promise<Article | null> {
  const result = await client.wp_posts.findFirst({
    where,
  });

  if (result == null) return null;

  return conformArticle(result);
}

function conformArticle(
  raw: Prisma.wp_postsGetPayload<{
    select: {
      ID: true;
      post_name: true;
      post_date_gmt: true;
      post_modified_gmt: true;
      post_title: true;
      post_content: true;
      post_author: true;
    };
  }>
): Article {
  const authorId = Number(raw.post_author);
  const dedupedAuthorId = dedupeAuthorId(authorId);

  return {
    id: hashArticle.encode(Number(raw.ID)),
    authorId: hashAuthor.encode(dedupedAuthorId),
    slug: raw.post_name,
    published: new Date(raw.post_date_gmt),
    updated: new Date(raw.post_modified_gmt),
    title: raw.post_title,
    content: cleanHtml(raw.post_content),
  };
}

function whereArticleIdIn(ids: number[]): Prisma.wp_postsWhereInput {
  return {
    post_status: "publish",
    post_type: "post",
    post_date_gmt: { lte: new Date() },
    ID: { in: ids },
  };
}

function whereArticleAuthorId(id: number): Prisma.wp_postsWhereInput {
  const authorIds = relatedAuthorIds(id);
  return {
    post_author: { in: [...authorIds.otherIds, authorIds.canonicalId] },
    // TODO: merge with whereArticleSlug (DRY)
    post_status: "publish",
    post_type: "post",
    post_date_gmt: { lte: new Date() },
  };
}

function whereArticleSlug(slug: string): Prisma.wp_postsWhereInput {
  return {
    post_name: slug,
    post_status: "publish",
    post_type: "post",
    post_date_gmt: { lte: new Date() },
  };
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

function dedupeAuthorId(id: number): number {
  return (
    mergeConfigs.find((config) => config.from?.includes(id) ?? false)?.to ?? id
  );
}

function relatedAuthorIds(id: number): {
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

async function* objectsInCategory(
  category: CategoryConfig,
  batchSize = 20,
  firstCursor?: string | null
) {
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

function toArticleCursorSting(cursor: ArticleCursor): string {
  return [cursor.object_id, cursor.term_taxonomy_id]
    .map((part) => JSON.stringify(Number(part)))
    .map((part) => encodeURIComponent(part))
    .join("//");
}

function fromArticleCursorString(str: string): ArticleCursor {
  const [object_id, term_taxonomy_id] = str
    .split("//")
    .map((part) => decodeURIComponent(part))
    .map((part) => JSON.parse(part));

  return {
    object_id,
    term_taxonomy_id,
  };
}

function getCategoryById(id: string) {
  const category = Object.values(config.categories).find((x) => x.id == id);
  if (category == null) throw new Error(`Category ${id} not found`);
  return category;
}

@ObjectType()
class Image {
  @Field(() => String, { nullable: true })
  caption: string | null;
  @Field(() => String, { nullable: true })
  mimeType: string | null;
  @Field(() => String, { nullable: true })
  alt: string | null;

  url: string;
}

@Resolver(Image)
export class ImageResolver {
  @FieldResolver(() => String)
  url(@Root() image: Image): string {
    return image.url;
  }
}

function textOrNull(s: string | null | undefined): string | null {
  if (s == null) return null;
  let x = s.trim();
  return x.length > 0 ? x : null;
}

async function getFeaturedImage(postId: number): Promise<Image | null> {
  // TODO: these two requests could easily be merged into one join.
  // Prisma can't do this easily unfortunately
  const meta = await client.wp_postmeta.findFirst({
    where: { post_id: postId, meta_key: "_thumbnail_id" },
    select: { meta_value: true },
  });

  if (meta == null) return null;

  return await findImage(Number(meta.meta_value));
}

async function findImage(imageId: number): Promise<Image | null> {
  const [image, alt] = await Promise.all([
    client.wp_posts.findUnique({
      where: { ID: imageId },
      select: { guid: true, post_mime_type: true, post_excerpt: true },
    }),
    client.wp_postmeta.findFirst({
      select: { meta_value: true },
      where: { post_id: imageId, meta_key: "_wp_attachment_image_alt" },
    }),
  ]);

  if (image == null) return null;

  return {
    url: rewriteWordpressImage(image.guid),
    mimeType: textOrNull(image.post_mime_type),
    caption: textOrNull(image.post_excerpt),
    alt: textOrNull(alt?.meta_value),
  };
}

function rewriteWordpressImage(url: string): string {
  const x = new URL(url);
  return ["https://cms.studentnewspaper.org", x.pathname, x.search].join("");
}

async function main() {
  await client.$connect();

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

  const { url } = await server.listen(8076);
  console.log(`Server listening at ${url}`);
}

main().catch((err) => {
  throw err;
});
