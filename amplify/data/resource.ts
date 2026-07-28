import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({
  // 球员表：只存名字
  Player: a.model({
    name: a.string().required(),
  }).authorization((allow) => [allow.publicApiKey()]),

  // 比赛记录表：记录单打/双打、胜负双方、比分
  Match: a.model({
    matchType: a.string().required(), // "单打" 或 "双打"
    winnerName: a.string().required(), // 胜方姓名
    loserName: a.string().required(),  // 败方姓名
    score: a.string().required(),      // 比分（例如 "6-4, 3-6, 10-8"）
    date: a.string().required(),       // 比赛日期
  }).authorization((allow) => [allow.publicApiKey()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'apiKey',
    apiKeyAuthorizationMode: { expiresInDays: 30 },
  },
});