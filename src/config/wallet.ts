import { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_HOST } from './constants.js'

type AskarPostgresStorageConfig = {
  type: 'postgres'
  config: {
    host: string
    connectTimeout?: number
    idleTimeout?: number
    maxConnections?: number
    minConnections?: number
  }
  credentials: { account: string; password: string; adminAccount?: string; adminPassword?: string }
}

export const askarPostgresConfig: AskarPostgresStorageConfig = {
  type: 'postgres',
  config: {
    host: POSTGRES_HOST as string,
    connectTimeout: 10,
  },
  credentials: {
    account: POSTGRES_USER as string,
    password: POSTGRES_PASSWORD as string,
    adminAccount: POSTGRES_USER as string,
    adminPassword: POSTGRES_PASSWORD as string,
  },
}

export const keyDerivationMethodMap: Record<string, 'kdf:argon2i:int' | 'kdf:argon2i:mod' | 'raw'> = {
  ARGON2I_INT: 'kdf:argon2i:int',
  ARGON2I_MOD: 'kdf:argon2i:mod',
  RAW: 'raw',
}
