import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Flock Off Pro: one non-consumable store product that unlocks the driving-comfort features
 * (spoken alerts, automatic drive mode, live countdown, trip packs, alert tuning). Every alert,
 * camera type and the reporting features stay free.
 *
 * The entitlement is cached in AsyncStorage so background tasks (which may run without the UI)
 * can check it without talking to the store. The store is re-checked on every app start, so a
 * refund removes Pro the next time the app opens.
 */

export const PRO_SKU = 'flockoff_pro';
export const PRO_FALLBACK_PRICE = '$4.99';

const KEY = 'flockoff.pro.v1';

type ProState = {
  /** The store reports an owned, completed purchase of PRO_SKU. */
  owned: boolean;
  /** Development builds only: unlocked from the paywall for testing. */
  devUnlock: boolean;
  checkedAt: number;
};

const EMPTY: ProState = { owned: false, devUnlock: false, checkedAt: 0 };

const listeners = new Set<(pro: boolean) => void>();

async function readState(): Promise<ProState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<ProState>) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

async function writeState(patch: Partial<ProState>): Promise<boolean> {
  const next = { ...(await readState()), ...patch };
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  const pro = next.owned || (__DEV__ && next.devUnlock);
  listeners.forEach((l) => l(pro));
  return pro;
}

/** Cheap check for engines and background tasks. */
export async function isPro(): Promise<boolean> {
  const s = await readState();
  return s.owned || (__DEV__ && s.devUnlock);
}

export async function setDevUnlock(on: boolean): Promise<void> {
  if (!__DEV__) return;
  await writeState({ devUnlock: on });
}

/* ------------------------------------------------------------------ store */

const storeAvailable = Platform.OS === 'ios' || Platform.OS === 'android';

type Iap = typeof import('expo-iap');
let iapPromise: Promise<Iap | null> | null = null;

/** Load the store module lazily so the web build and Expo Go do not crash on a missing native module. */
function iap(): Promise<Iap | null> {
  if (!storeAvailable) return Promise.resolve(null);
  if (!iapPromise) {
    iapPromise = import('expo-iap')
      .then(async (m) => {
        await m.initConnection();
        return m;
      })
      .catch((e) => {
        console.warn('[flockoff] store unavailable', e);
        iapPromise = null;
        return null;
      });
  }
  return iapPromise;
}

type PurchaseLike = { productId: string; purchaseState: string };

async function settle(m: Iap, purchase: PurchaseLike): Promise<boolean> {
  if (purchase.productId !== PRO_SKU || purchase.purchaseState !== 'purchased') return false;
  // Google refunds purchases that are not acknowledged within three days; finishing does that.
  try {
    await m.finishTransaction({ purchase: purchase as Parameters<Iap['finishTransaction']>[0]['purchase'], isConsumable: false });
  } catch {
    // already acknowledged
  }
  await writeState({ owned: true, checkedAt: Date.now() });
  return true;
}

/** Re-read what the store says the user owns. Safe to call on every launch. */
export async function refreshEntitlement(): Promise<boolean> {
  const m = await iap();
  if (!m) return isPro();
  try {
    const purchases = (await m.getAvailablePurchases()) as PurchaseLike[];
    const owned = purchases.find((p) => p.productId === PRO_SKU && p.purchaseState === 'purchased');
    if (owned) return settle(m, owned);
    return writeState({ owned: false, checkedAt: Date.now() });
  } catch (e) {
    console.warn('[flockoff] entitlement check failed', e);
    return isPro(); // offline: keep the cached answer
  }
}

/** Localized price from the store, or the fallback when the store is not reachable. */
export async function proPrice(): Promise<string> {
  const m = await iap();
  if (!m) return PRO_FALLBACK_PRICE;
  try {
    const products = (await m.fetchProducts({ skus: [PRO_SKU], type: 'in-app' })) as { id: string; displayPrice: string }[] | null;
    return products?.find((p) => p.id === PRO_SKU)?.displayPrice ?? PRO_FALLBACK_PRICE;
  } catch {
    return PRO_FALLBACK_PRICE;
  }
}

export type BuyResult = { ok: boolean; message?: string };

/**
 * Start the store purchase sheet and wait for its outcome. The result arrives through the
 * purchase listeners, not the request's return value.
 */
export async function buyPro(): Promise<BuyResult> {
  const m = await iap();
  if (!m) return { ok: false, message: 'Purchases need the store build of the app.' };
  return new Promise<BuyResult>((resolve) => {
    let done = false;
    const finish = (r: BuyResult) => {
      if (done) return;
      done = true;
      ok.remove();
      err.remove();
      resolve(r);
    };
    const ok = m.purchaseUpdatedListener(async (p) => {
      if (await settle(m, p as PurchaseLike)) finish({ ok: true });
    });
    const err = m.purchaseErrorListener((e) => {
      finish(e.code === m.ErrorCode.UserCancelled ? { ok: false } : { ok: false, message: e.message });
    });
    m.requestPurchase({ request: { apple: { sku: PRO_SKU }, google: { skus: [PRO_SKU] } }, type: 'in-app' }).catch((e: unknown) =>
      finish({ ok: false, message: e instanceof Error ? e.message : String(e) }),
    );
  });
}

export async function restorePro(): Promise<boolean> {
  const m = await iap();
  if (!m) return isPro();
  try {
    await m.restorePurchases();
  } catch {
    // fall through to the purchase list
  }
  return refreshEntitlement();
}

/**
 * Purchases can complete while the app is closed (a pending card payment, a purchase on another
 * device). Listening from launch settles them as soon as they arrive.
 */
export async function startPurchaseListener(): Promise<() => void> {
  const m = await iap();
  if (!m) return () => {};
  const sub = m.purchaseUpdatedListener((p) => {
    settle(m, p as PurchaseLike).catch(() => {});
  });
  return () => sub.remove();
}

/** Live Pro flag for screens. */
export function usePro(): boolean | null {
  const [pro, setPro] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    isPro().then((v) => alive && setPro(v));
    const l = (v: boolean) => alive && setPro(v);
    listeners.add(l);
    return () => {
      alive = false;
      listeners.delete(l);
    };
  }, []);
  return pro;
}
