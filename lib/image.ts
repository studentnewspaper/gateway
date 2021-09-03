import { textOrNull } from "./utils";
import { Resolver, FieldResolver, Root } from "type-graphql";
import { Image } from "./types";
import { client } from "./client";

@Resolver(Image)
export class ImageResolver {
  @FieldResolver(() => String)
  url(@Root() image: Image): string {
    return image.url;
  }
}

export async function getFeaturedImage(postId: number): Promise<Image | null> {
  // TODO: these two requests could easily be merged into one join.
  // Prisma can't do this easily unfortunately
  const meta = await client.wp_postmeta.findFirst({
    where: { post_id: postId, meta_key: "_thumbnail_id" },
    select: { meta_value: true },
  });

  if (meta == null) return null;

  return await findImage(Number(meta.meta_value));
}

export async function findImage(imageId: number): Promise<Image | null> {
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
