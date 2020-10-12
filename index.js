const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const graphqlHTTP = require('express-graphql');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Sequelize, DataTypes } = require('sequelize');

const { makeExecutableSchema } = require('graphql-tools');

const PORT = process.env.PORT || 5000;

const db = new Sequelize(process.env.DATABASE_URL);
const MyDataTypes = {
  TablePrimaryKey: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4,
  },
};

// User 
const UserTable = db.define('User', {
  uuid: MyDataTypes.TablePrimaryKey,
  username: DataTypes.STRING,
  passwordHash: DataTypes.STRING,
  token: DataTypes.STRING,
});
const UserGraphQLTypeDefinition = `
  type User {
    uuid: String!
    username: String!
    token: String
  }
`;

// Standard Proposal
const StandardProposalTable = db.define('StandardProposal', {
  uuid: MyDataTypes.TablePrimaryKey,
  version: DataTypes.STRING,
  data: DataTypes.TEXT,
});
const StandardProposalGraphQLTypeDefinition = `
  type StandardProposal {
    uuid: String!
    version: String!
    data: String
  }
`;

// Proposal
const ProposalTable = db.define('Proposal', {
  uuid: MyDataTypes.TablePrimaryKey,
  data: DataTypes.TEXT,
});
const ProposalGraphQLTypeDefinition = `
  type Proposal {
    uuid: String!
    data: String
  }
`;


async function createContext(req) {
  const token = req.headers ? req.headers.authorization : null;
  if (token === '' || token == null) {
    return null;
  };
  const user = await UserTable.findOne({ where: { token } });
  return { userId: user.uuid };
}

express()
  .use(cors())
  .use(bodyParser.json())
  .use(bodyParser.urlencoded({ extended: true }))
  .use(
    '/graphql',
    graphqlHTTP(async req => ({
      schema: makeExecutableSchema({
        typeDefs: `
          ${UserGraphQLTypeDefinition}
          ${ProposalGraphQLTypeDefinition}
          ${StandardProposalGraphQLTypeDefinition}
          type Query {
            user: User
            standardProposal: StandardProposal
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
            user: (_, __, { userId }) => UserTable.findOne({ where: { uuid: userId } }),

            proposals: () => ProposalTable.findAll(),

            proposal: (_, { uuid }) => ProposalTable.findOne({ where: { uuid } }),

            latestStandard: () => StandardProposalTable.findAll({
              limit: 1,
              order: [['createdAt', 'DESC']]
            }),
          },
          Mutation: {
            addProposal: async (_, { proposal }) => {
              const newProposal = await ProposalTable.create({ proposal });
              return { uuid: newProposal.uuid, data: proposal };
            },

            login: async (_, { username, password }) => {
              const user = await UserTable.findOne({ where: { username } });
              if (!user || !bcrypt.compareSync(password, user.password)) {
                return null;
              }
              const token = jwt.sign({ id: user.uuid }, process.env.JWT_SECRET);
              await user.update({ token });
              return { token };
            },

            logout: async (_, __, { userId }) => {
              await UserTable.update({ where: { userId } }, { token: null });
              return true;
            }
          },
        },
      }),
      context: await createContext(req),
      graphiql: true,
    })))
  .listen(PORT, () => console.log(`Listening on ${PORT}`))
