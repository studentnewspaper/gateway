import { ExecutionRequest } from "@graphql-tools/utils";
import { print } from "graphql";
import { SubschemaConfig } from "@graphql-tools/delegate";
import {
  introspectSchema,
  RenameInputObjectFields,
  RenameInterfaceFields,
  RenameObjectFields,
  RenameRootFields,
  RenameTypes,
  TransformObjectFields,
} from "@graphql-tools/wrap";
import camelcase from "camelcase";
import { fetch } from "cross-fetch";

async function executor({ document, variables }: ExecutionRequest) {
  const query = print(document);
  const fetchResult = await fetch(process.env.ORION_URL!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ORION_TOKEN!}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (fetchResult.status != 200) {
    const output = await fetchResult.text();
    console.error(output);
    throw new Error(`Orion returned with ${fetchResult.status} status`);
  }

  return fetchResult.json();
}

async function _getOrionSchema(): Promise<SubschemaConfig> {
  let schema = await introspectSchema(executor);

  const orionSchema: SubschemaConfig = {
    schema,
    executor,
    transforms: [
      new RenameRootFields((op, name) => camelcase(name)),
      new RenameObjectFields((op, name) => camelcase(name)),
      new RenameInputObjectFields((op, name) => camelcase(name)),
      new RenameInterfaceFields((op, name) => camelcase(name)),
      new RenameTypes((name) => {
        name = camelcase(name, { pascalCase: true })
          // TODO: Automatically remove plurals
          .replaceAll("Categories", "Category")
          .replaceAll("Vacancies", "Vacancy")
          .replaceAll("Adverts", "Advert");
        return name;
      }),
      new TransformObjectFields((type, field, config) => {
        if (type == "Advert") {
          if (
            [
              "trackingSource",
              "trackingMedium",
              "trackingCampaign",
              "trackingCampaignId",
            ].includes(field)
          ) {
            // Remove field
            return null;
          }
        }
        // Keep field as is
        return undefined;
      }),
    ],
  };

  return orionSchema;
}

let cached: SubschemaConfig | null = null;

export async function getOrionSchema(): Promise<SubschemaConfig> {
  if (cached == null) {
    cached = await _getOrionSchema();
  }

  return cached;
}
