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

/**
 * User
 */
const UserTable = db.define('User', {
  uuid: MyDataTypes.TablePrimaryKey,
  username: DataTypes.STRING,
  passwordHash: DataTypes.STRING,
  token: DataTypes.STRING,
  votedProposals: { type: DataTypes.ARRAY(DataTypes.UUID), defaultValue: [] },
});

const UserGraphQLTypeDefinition = `
  type User {
    uuid: String!
    username: String!
    token: String
  }
`;
const UserRootField = {
  definition: 'user: User',
  resolver: {
    user: (_, __, { userId }) => UserTable.findOne({ where: { uuid: userId } }),
  },
};

const LoginMutation = {
  definition: 'login(username: String!, password: String!): String',
  resolver: {
    login: async (_, { username, password }) => {
      const user = await UserTable.findOne({ where: { username } });
      if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
        return null;
      }
      const token = jwt.sign({ id: user.uuid }, process.env.JWT_SECRET);
      await user.update({ token });
      return token;
    },
  },
};

const LogoutMutation = {
  definition: 'logout: Boolean',
  resolver: {
    logout: async (_, __, { userId }) => {
      const user = await UserTable.findOne({ where: { uuid: userId } });
      await user.update({ token: null })
      return true;
    }
  },
};

/**
 * Standard Proposal
 */
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

const StandardProposalRootField = {
  defintion: `standardProposal: StandardProposal`,
  resolver: {
    standardProposal: async () => {
      const standardProposals = await StandardProposalTable.findAll({
        limit: 1,
        order: [['createdAt', 'DESC']]
      });
      return standardProposals[0];
    },
  }
}

/**
 * Proposal
 */
const ProposalTable = db.define('Proposal', {
  uuid: MyDataTypes.TablePrimaryKey,
  userId: DataTypes.UUID,
  data: DataTypes.TEXT,
});

const ProposalGraphQLTypeDefinition = `
  type Proposal {
    uuid: String!
    data: String
  }
`;
const ProposalRootField = {
  definition: 'proposal(uuid: String!): Proposal',
  resolver: {
    proposal: (_, { uuid }) => ProposalTable.findOne({ where: { uuid } }),
  },
};

const ProposalsRootField = {
  definition: 'proposals: [Proposal]',
  resolver: {
    proposals: () => ProposalTable.findAll(),
  }
};

const AddProposalMutation = {
  definition: 'addProposal(proposal: String): Proposal',
  resolver: {
    addProposal: async (_, { proposal }, { userId }) => {
      if (!userId) {
        return null;
      }
      const newProposal = await ProposalTable.create({ data: proposal, userId });
      return { uuid: newProposal.uuid, data: proposal };
    }
  },
};

const VoteProposalMutation = {
  definition: 'voteProposal(proposalId: String!, position: Int): Boolean',
  resolver: {
    voteProposal: async (_, { proposalId, position }, { userId }) => {
      if (!userId) {
        return false;
      }

      const user = await UserTable.findOne({ where: { uuid: userId } });
      const votedProposals = user.votedProposals != null ? user.votedProposals : [];

      if (position == null || position <= 0) {
        await user.update({
          votedProposals: votedProposals.filter(id => id !== proposalId),
        });
      } else if (position > votedProposals.length) {
        await user.update({
          votedProposals: votedProposals.concat(proposalId),
        });
      } else {
        await user.update({
          votedProposals: votedProposals.slice().splice(position - 1, 0, id),
        });
      }
      return true;
    }
  },
};

// Associations
UserTable.hasMany(ProposalTable);
ProposalTable.belongsTo(UserTable, { foreignKey: 'userId', onDelete: 'CASCADE' });

// Update all tables
db.sync({ alter: true });

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
            ${ProposalRootField.definition},
            ${ProposalsRootField.definition},
            ${StandardProposalRootField.defintion},
            ${UserRootField.definition},
          }
          type Mutation {
            ${AddProposalMutation.definition},
            ${LoginMutation.definition},
            ${LogoutMutation.definition},
            ${VoteProposalMutation.definition},
          }
        `,
        resolvers: {
          Query: {
            ...ProposalRootField.resolver,
            ...ProposalsRootField.resolver,
            ...StandardProposalRootField.resolver,
            ...UserRootField.resolver,
          },
          Mutation: {
            ...AddProposalMutation.resolver,
            ...LoginMutation.resolver,
            ...LogoutMutation.resolver,
            ...VoteProposalMutation.resolver,
          },
        },
      }),
      context: await createContext(req),
      graphiql: true,
    })))
  .listen(PORT, () => console.log(`Listening on ${PORT}`))
