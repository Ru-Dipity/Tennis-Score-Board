import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({
  Player: a.model({
    name: a.string().required(),
  }).authorization((allow) => [allow.publicApiKey()]),

  Match: a.model({
    matchType: a.string().required(),
    winnerName: a.string().required(),
    loserName: a.string().required(),
    score: a.string().required(),
    date: a.string().required(),
  }).authorization((allow) => [allow.publicApiKey()]),
});

export type Schema = ClientSchema<typeof schema>; // 👈 这一行非常关键

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'apiKey',
    apiKeyAuthorizationMode: { expiresInDays: 30 },
  },
});