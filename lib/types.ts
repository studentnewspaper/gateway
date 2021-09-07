import { ObjectType, Field, ID } from "type-graphql";

@ObjectType()
export class Article {
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

@ObjectType()
export class Author {
  @Field((type) => ID)
  id: string;
  @Field()
  slug: string;
  @Field()
  name: string;
  @Field(() => String, { nullable: true })
  bio: string | null;
}

@ObjectType()
export class Category {
  wordpressTags: number[];
}

@ObjectType()
export class ArticlesEdge {
  @Field()
  hasNextPage: boolean;
  @Field({ nullable: true })
  lastCursor: string;

  nodes: number[];
}

@ObjectType()
export class Image {
  @Field(() => String, { nullable: true })
  caption: string | null;
  @Field(() => String, { nullable: true })
  mimeType: string | null;
  @Field(() => String, { nullable: true })
  alt: string | null;

  url: string;
}
