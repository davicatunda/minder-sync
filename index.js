const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const graphqlHTTP = require('express-graphql');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

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
    graphqlHTTP(async req => ({
      schema: makeExecutableSchema({
        typeDefs: `
          type User {
            uuid: String!
            username: String!
            token: String
          }
          type Proposal {
            uuid: String!
            data: String
          }
          type Standard {
            uuid: String!
            version: String!
            data: String
          }
          type Query {
            user: User
            latestStandard: Standard
            proposals: [Proposal]
            proposal(uuid: String!): Proposal
          }
          type Mutation {
            addProposal(proposal: String): Proposal
            login(username: String!, password: String!): String
            logout: Boolean
          }
        `,
        resolvers: {
          Query: {
            user: async (_, __, { userId }) => {
              const { rows } = await pool.query(
                'SELECT * FROM users WHERE uuid = $1',
                [userId]
              );
              return rows ? rows[0] : null;
            },

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
            },

            latestStandard: async () => {
              const { rows } = await pool.query('SELECT * FROM standard ORDER BY uuid DESC LIMIT 1');
              return rows[0];
            },
          },
          Mutation: {
            addProposal: async (_, { proposal }) => {
              const { rows } = await pool.query(
                'INSERT INTO proposals (proposal) VALUES ($1) RETURNING uuid',
                [proposal]
              );
              return { uuid: rows[0].uuid, data: proposal };
            },

            login: async (_, { username, password }) => {
              const { rows } = await pool.query(
                'SELECT * FROM users WHERE username = $1',
                [username]
              );
              const user = rows[0];
              if (!user || !bcrypt.compareSync(password, user.password)) {
                return null;
              }
              const token = jwt.sign({ id: user.uuid }, process.env.JWT_SECRET);
              await pool.query(
                'UPDATE users SET token = $1 WHERE username = $2',
                [token, username],
              );
              return { token };
            },

            logout: async (_, __, { userId }) => {
              await pool.query(
                'UPDATE users SET token = NULL WHERE uuid = $1',
                [userId],
              );
              return true;
            }
          },
        },
      }),
      context: async () => {
        const token = req.headers ? req.headers.authorization : null;
        if (token === '' || token == null) {
          return null;
        };
        const { rows } = await pool.query(
          'SELECT * FROM users WHERE token = $1',
          [token]
        );
        return { userId: rows[0].uuid };
      },
      graphiql: true,
    })))
  .listen(PORT, () => console.log(`Listening on ${PORT}`))
