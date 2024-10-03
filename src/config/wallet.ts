import type { AskarWalletPostgresStorageConfig } from '@credo-ts/askar/build/wallet'

import { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_HOST } from './constants'
import { KeyDerivationMethod } from '@credo-ts/core'

export const askarPostgresConfig: AskarWalletPostgresStorageConfig = {
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

export const keyDerivationMethodMap: { [key: string]: KeyDerivationMethod } = {
  ARGON2I_INT: KeyDerivationMethod.Argon2IInt,
  ARGON2I_MOD: KeyDerivationMethod.Argon2IMod,
  RAW: KeyDerivationMethod.Raw,
}
