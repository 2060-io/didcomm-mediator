import { KeyDerivationMethod, WalletConfig } from '@credo-ts/core'
import { uriFromWalletConfig, keyDerivationMethodToStoreKeyMethod } from '@credo-ts/askar/build/utils'
import { Store } from '@hyperledger/aries-askar-nodejs'
import { agentDependencies } from '@credo-ts/node'
import { askarPostgresConfig, keyDerivationMethodMap } from '../config/wallet'
import { KEY_DERIVATION_METHOD, POSTGRES_HOST, WALLET_KEY, WALLET_NAME } from '../config/constants'

/**
 * This script is intended to be run in order to migrate a wallet from a place to another. It receives
 * any input and output wallet config, meaning that we can switch backends: e.g. copy a sqlite wallet
 * to a postgres database.
 *
 * Note: it throws error in case that the output database already exists.
 */

async function migrateWallet(inputWalletConfig: WalletConfig, outputWalletConfig: WalletConfig) {
  const store = await Store.open({
    uri: uriFromWalletConfig(inputWalletConfig, new agentDependencies.FileSystem().dataPath).uri,
    keyMethod: keyDerivationMethodToStoreKeyMethod(
      inputWalletConfig.keyDerivationMethod ?? KeyDerivationMethod.Argon2IMod
    ),
    passKey: inputWalletConfig.key,
  })

  await store.copyTo({
    uri: uriFromWalletConfig(outputWalletConfig, new agentDependencies.FileSystem().dataPath).uri,
    keyMethod: keyDerivationMethodToStoreKeyMethod(
      outputWalletConfig.keyDerivationMethod ?? KeyDerivationMethod.Argon2IMod
    ),
    passKey: outputWalletConfig.key,
    recreate: false,
  })

  await store.close()
}

async function run() {
  if (POSTGRES_HOST) {
    migrateWallet(
      {
        id: WALLET_NAME,
        key: WALLET_KEY,
        keyDerivationMethod: keyDerivationMethodMap[KEY_DERIVATION_METHOD ?? KeyDerivationMethod.Argon2IMod],
      },
      {
        id: WALLET_NAME,
        key: WALLET_KEY,
        keyDerivationMethod: keyDerivationMethodMap[KEY_DERIVATION_METHOD ?? KeyDerivationMethod.Argon2IMod],
        storage: askarPostgresConfig,
      }
    )
  }
}

run()
