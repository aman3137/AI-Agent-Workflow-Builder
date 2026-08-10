'use client';

import { ApolloClient, InMemoryCache, split, HttpLink } from '@apollo/client';
import { getMainDefinition } from '@apollo/client/utilities';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';

const GRAPHQL_HTTP_URL = 'http://localhost:8080/v1/graphql';
const GRAPHQL_WS_URL = 'ws://localhost:8080/v1/graphql';

export function createApolloClient() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  const httpLink = new HttpLink({
    uri: GRAPHQL_HTTP_URL,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  const wsLink = typeof window !== 'undefined'
    ? new GraphQLWsLink(
        createClient({
          url: GRAPHQL_WS_URL,
          connectionParams: () => {
            const t = localStorage.getItem('token');
            return {
              headers: {
                ...(t ? { Authorization: `Bearer ${t}` } : {}),
              },
            };
          },
        })
      )
    : null;

  const splitLink = wsLink
    ? split(
        ({ query }) => {
          const definition = getMainDefinition(query);
          return (
            definition.kind === 'OperationDefinition' &&
            definition.operation === 'subscription'
          );
        },
        wsLink,
        httpLink
      )
    : httpLink;

  return new ApolloClient({
    link: splitLink,
    cache: new InMemoryCache(),
    defaultOptions: {
      watchQuery: {
        fetchPolicy: 'no-cache',
      },
      query: {
        fetchPolicy: 'no-cache',
      },
    },
  });
}
