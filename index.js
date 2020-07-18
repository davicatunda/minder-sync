const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const graphqlHTTP = require('express-graphql');

const { Pool } = require('pg');
const { makeExecutableSchema } = require('graphql-tools');

const PORT = process.env.PORT || 5000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    // TODO: understand this
    rejectUnauthorized: false
  }
});

express()
  .use(cors())
  .use(bodyParser.json())
  .use(bodyParser.urlencoded({ extended: true }))
  .use(
    '/graphql',
    graphqlHTTP({
      schema: makeExecutableSchema({
        typeDefs: `
          type Proposal {
            uuid: String!
            proposal: String
          }
          type Query {
            proposals: [Proposal]
            proposal(uuid: String!): Proposal
          }
          type Mutation {
            addProposal(proposal: String): Proposal
          }
        `,
        resolvers: {
          Query: {
            proposals: async () => {
              const { rows } = await pool.query('SELECT * FROM proposals');
              return rows;
            },
            proposal: async (_, { uuid }) => {
              const { rows } = await pool.query(
                'SELECT * FROM proposals WHERE uuid = $1',
                [uuid]
              );
              return rows[0];
            }
          },
          Mutation: {
            addProposal: async (_, { proposal }) => {
              const { rows } = await pool.query(
                'INSERT INTO proposals (proposal) VALUES ($1) RETURNING uuid',
                [proposal]
              );
              return { uuid: rows[0].uuid, proposal };
            }
          },
        },
      }),
      graphiql: true,
    }))
  .listen(PORT, () => console.log(`Listening on ${PORT}`))
