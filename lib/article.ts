import { Prisma } from "@prisma/client";
import {
  dedupeAuthorId,
  findAuthor,
  relatedAuthorIds,
  whereAuthorId,
} from "./author";
import { cleanHtml } from "./cleaner";
import { client } from "./client";
import { getFeaturedImage } from "./image";
import { Article, ArticlesEdge, Author, Image } from "./types";
import { hashAuthor, hashArticle, isTruthy } from "./utils";
import { Resolver, Query, Arg, FieldResolver, Root } from "type-graphql";

@Resolver(Article)
export class ArticleResolver {
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

@Resolver(ArticlesEdge)
export class ArticlesEdgeResolver {
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

export async function findArticles(
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

export async function findArticle(
  where: Prisma.wp_postsWhereInput
): Promise<Article | null> {
  const result = await client.wp_posts.findFirst({
    where,
  });

  if (result == null) return null;

  return conformArticle(result);
}

export function conformArticle(
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

export function whereArticleIdIn(ids: number[]): Prisma.wp_postsWhereInput {
  return {
    post_status: "publish",
    post_type: "post",
    post_date_gmt: { lte: new Date() },
    ID: { in: ids },
  };
}

export function whereArticleAuthorId(id: number): Prisma.wp_postsWhereInput {
  const authorIds = relatedAuthorIds(id);
  return {
    post_author: { in: [...authorIds.otherIds, authorIds.canonicalId] },
    // TODO: merge with whereArticleSlug (DRY)
    post_status: "publish",
    post_type: "post",
    post_date_gmt: { lte: new Date() },
  };
}

export function whereArticleSlug(slug: string): Prisma.wp_postsWhereInput {
  return {
    post_name: slug,
    post_status: "publish",
    post_type: "post",
    post_date_gmt: { lte: new Date() },
  };
}
