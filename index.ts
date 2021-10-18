import "reflect-metadata";
import { ApolloServer, ApolloError } from "apollo-server";
import { ApolloServerPluginInlineTrace } from "apollo-server-core";
import { init as prismaInit } from "./lib/client";
import { stitchSchemas } from "@graphql-tools/stitch";
import { ApolloServerPlugin } from "apollo-server-plugin-base";
import * as Sentry from "@sentry/node";
import {
  FilterObjectFields,
  PruneSchema,
  wrapSchema,
} from "@graphql-tools/wrap";
import { getOrionSchema } from "./lib/schemas/orion";
import { getLocalSchema } from "./lib/schemas/local";
import { delegateToSchema } from "@graphql-tools/delegate";

const requiredEnvs = ["ORION_URL", "ORION_TOKEN", "DATABASE_URL"];
for (const env of requiredEnvs) {
  if (typeof env != "string") {
    throw new Error(`Required ${env} environment variable not found`);
  }
}

const dsn = process.env.SENTRY_DSN;
const isProduction = process.env.NODE_ENV == "production";

Sentry.init({
  dsn,
  enabled: isProduction && dsn != null,
});

const ErrorPlugin: ApolloServerPlugin = {
  requestDidStart: async (ctx) => {
    return {
      didEncounterErrors: async (ctx) => {
        // Could not parse request, ignore
        if (ctx.operation == null) return;

        for (const err of ctx.errors) {
          if (err instanceof ApolloError) {
            continue;
          }

          Sentry.withScope((scope) => {
            // Annotate whether failing operation was query/mutation/subscription
            scope.setTag("kind", ctx.operation?.operation);
            scope.setExtra("query", ctx.request.query);
            scope.setExtra("variables", ctx.request.variables);
            if (err.path) {
              scope.addBreadcrumb({
                category: "query-path",
                message: err.path.join(" > "),
                level: Sentry.Severity.Debug,
              });
            }
            Sentry.captureException(err);
          });
        }
      },
    };
  },
};

async function main() {
  await prismaInit();

  const [localSchema, orionSchema] = await Promise.all([
    getLocalSchema(),
    getOrionSchema(),
  ]);

  const schema = stitchSchemas({
    subschemas: [localSchema, orionSchema],
    typeDefs: `
      extend type Query {
        advert: Advert
      }
    `,
    resolvers: {
      Query: {
        advert: {
          resolve: async (_, __, context, info) => {
            const adverts: any[] | null = await delegateToSchema({
              schema: orionSchema,
              context,
              info,
              operation: "query",
              fieldName: "adverts",
            });

            if (adverts != null && adverts.length > 0) {
              return adverts[0];
            }

            return null;
          },
        },
      },
      Advert: {
        link: {
          selectionSet: `{
            link
            trackingSource
            trackingMedium
            trackingCampaign
            trackingCampaignId
          }`,
          resolve: (advert: {
            link: string | null;
            trackingSource: string | null;
            trackingMedium: string | null;
            trackingCampaign: string | null;
            trackingCampaignId: string | null;
          }) => {
            if (advert.link == null) return null;
            const url = new URL(advert.link);

            const rawParams = {
              utm_source: advert.trackingSource,
              utm_medium: advert.trackingMedium,
              utm_campaign: advert.trackingCampaign,
              utm_id: advert.trackingCampaignId,
            };

            for (const [key, value] of Object.entries(rawParams)) {
              if (value == null) continue;
              if (url.searchParams.has(key)) continue;
              url.searchParams.append(key, value);
            }

            return url.toString();
          },
        },
      },
    },
  });

  const simplifiedSchema = wrapSchema({
    schema,
    transforms: [
      new FilterObjectFields((type, field) => {
        if (type == "Query") {
          if (["adverts", "advertsById"].includes(field)) {
            return false;
          }
        }
        return true;
      }),
      new PruneSchema(),
    ],
  });

  const server = new ApolloServer({
    schema: simplifiedSchema,
    plugins: [ApolloServerPluginInlineTrace(), ErrorPlugin],
  });

  const port = process.env.PORT || 8076;
  const { url } = await server.listen(port);
  console.log(`Server listening at ${url}`);
}

main().catch((err) => {
  console.error(err);
  throw err;
});
