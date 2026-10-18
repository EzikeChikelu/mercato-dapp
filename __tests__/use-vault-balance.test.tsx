import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { act, renderHook } from '@testing-library/react'

const vaultFetch = mock(async (_address: string) => ({
  underlyingTotal: 0,
  underlyingTotalRaw: 0,
  dfTokens: 0,
  vaultAddress: 'vault',
  network: 'testnet',
}))
const sacFetch = mock(async (_address: string, _asset: string) => ({
  displayBalance: 0,
  rawBalance: '0',
}))

mock.module('@/lib/defindex/vault-cache', () => ({
  hasClientVaultConfigured: () => true,
  vaultBalanceRequest: { fetch: vaultFetch },
  sacBalanceRequest: { fetch: sacFetch },
  isRateLimitMessage: (message: string) => /rate limit/i.test(message),
}))

const { useVaultBalance } = await import('@/hooks/use-vault-balance')

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useVaultBalance request ownership', () => {
  beforeEach(() => {
    vaultFetch.mockReset()
    sacFetch.mockReset()
    vaultFetch.mockImplementation(async () => ({
      underlyingTotal: 0,
      underlyingTotalRaw: 0,
      dfTokens: 0,
      vaultAddress: 'vault',
      network: 'testnet',
    }))
    sacFetch.mockImplementation(async () => ({ displayBalance: 0, rawBalance: '0' }))
  })

  afterEach(() => {
    mock.restore()
  })

  test('keeps account B balances when account A resolves later', async () => {
    const vaultA = deferred<{ underlyingTotal: number; underlyingTotalRaw: number; dfTokens: number; vaultAddress: string; network: string }>()
    const walletA = deferred<{ displayBalance: number; rawBalance: string }>()
    const vaultB = deferred<{ underlyingTotal: number; underlyingTotalRaw: number; dfTokens: number; vaultAddress: string; network: string }>()
    const walletB = deferred<{ displayBalance: number; rawBalance: string }>()

    vaultFetch.mockImplementation((address) => address === 'A' ? vaultA.promise : vaultB.promise)
    sacFetch.mockImplementation((address) => address === 'A' ? walletA.promise : walletB.promise)

    const { result } = renderHook(() => useVaultBalance())
    let loadA!: Promise<unknown>
    let loadB!: Promise<unknown>

    await act(async () => {
      loadA = result.current.loadUserBalancesRef.current('A', 'asset')
      loadB = result.current.loadUserBalancesRef.current('B', 'asset')
      vaultB.resolve({ underlyingTotal: 22, underlyingTotalRaw: 220, dfTokens: 2, vaultAddress: 'vault', network: 'testnet' })
      walletB.resolve({ displayBalance: 33, rawBalance: '330' })
      await loadB
      vaultA.resolve({ underlyingTotal: 11, underlyingTotalRaw: 110, dfTokens: 1, vaultAddress: 'vault', network: 'testnet' })
      walletA.resolve({ displayBalance: 44, rawBalance: '440' })
      await loadA
    })

    expect(result.current.vaultBalance).toBe(22)
    expect(result.current.vaultRawBalance).toBe(220)
    expect(result.current.dfTokens).toBe(2)
    expect(result.current.walletBalance).toBe(33)
    expect(result.current.walletRawBalance).toBe(330)
    expect(result.current.isLoadingBalances).toBe(false)
  })

  test('does not use account A cache as a rate-limit fallback for account B', async () => {
    vaultFetch.mockImplementation(async (address) => {
      if (address === 'A') {
        return { underlyingTotal: 17, underlyingTotalRaw: 170, dfTokens: 7, vaultAddress: 'vault', network: 'testnet' }
      }
      throw new Error('Rate limit exceeded')
    })
    sacFetch.mockImplementation(async (address) => ({
      displayBalance: address === 'A' ? 19 : 0,
      rawBalance: address === 'A' ? '190' : '0',
    }))

    const { result } = renderHook(() => useVaultBalance())
    await act(async () => {
      await result.current.loadUserBalancesRef.current('A', 'asset')
    })
    await act(async () => {
      await result.current.loadUserBalancesRef.current('B', 'asset')
    })

    expect(result.current.vaultBalance).toBe(0)
    expect(result.current.vaultRawBalance).toBe(0)
    expect(result.current.dfTokens).toBe(0)
    expect(result.current.walletBalance).toBe(0)
  })

  test('disconnect invalidation prevents pending requests from restoring balances', async () => {
    const vaultPending = deferred<{ underlyingTotal: number; underlyingTotalRaw: number; dfTokens: number; vaultAddress: string; network: string }>()
    const walletPending = deferred<{ displayBalance: number; rawBalance: string }>()
    vaultFetch.mockImplementation(() => vaultPending.promise)
    sacFetch.mockImplementation(() => walletPending.promise)

    const { result } = renderHook(() => useVaultBalance())
    let load!: Promise<unknown>
    await act(async () => {
      load = result.current.loadUserBalancesRef.current('A', 'asset')
      result.current.resetBalances()
      vaultPending.resolve({ underlyingTotal: 50, underlyingTotalRaw: 500, dfTokens: 5, vaultAddress: 'vault', network: 'testnet' })
      walletPending.resolve({ displayBalance: 60, rawBalance: '600' })
      await load
    })

    expect(result.current.vaultBalance).toBe(0)
    expect(result.current.walletBalance).toBe(0)
    expect(result.current.dfTokens).toBe(0)
    expect(result.current.isLoadingBalances).toBe(false)
  })
})
