"use server";

/**
 * 화면(클라이언트)에서 부를 수 있는 검색.
 *
 * `search.ts` 는 서버 전용 모듈이라 클라이언트 컴포넌트가 직접 import 하면
 * 번들에 DB 코드가 딸려 들어가 깨진다. 여기서 서버 액션으로 감싼다.
 */
import { findProducts, findVehicles, type ProductFilter, type ProductHit, type VehicleHit } from "./search";

export async function searchProducts(q: string, filter?: ProductFilter): Promise<ProductHit[]> {
  return findProducts(q, filter);
}

export async function searchVehicles(q: string): Promise<VehicleHit[]> {
  return findVehicles(q);
}
