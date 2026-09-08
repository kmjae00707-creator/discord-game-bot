'use strict';

const crypto = require('crypto');

/**
 * 토스 입금 알림에는 금액이 항상 있고, 입금자명은 알림 종류에 따라 있을 수도 없을 수도 있습니다.
 * 따라서 각 충전 요청마다 (1) 겹치지 않는 고유 금액 + (2) 입금자명을 함께 저장하고,
 * 실제 입금 시 금액과 이름을 대조해 본인을 식별합니다.
 * 이름이 없거나 다르면 자동충전하지 않고 관리자 승인 대기로 넘깁니다.
 */

// 요청 유효 시간 (기본 30분)
const REQUEST_TTL_MS = Number(process.env.DEPOSIT_REQUEST_TTL_MS) || 30 * 60 * 1000;

// 승인 대기 유효 시간 (기본 24시간)
const APPROVAL_TTL_MS =
  Number(process.env.DEPOSIT_APPROVAL_TTL_MS) || 24 * 60 * 60 * 1000;

// 금액 충돌 시 붙일 수 있는 최대 추가 원(1~MAX_OFFSET)
const MAX_OFFSET = Number(process.env.DEPOSIT_MAX_OFFSET) || 99;

/**
 * @typedef {object} DepositRequest
 * @property {string} userId
 * @property {string} username
 * @property {string} expectedName 유저가 입력한 입금자명(정규화 전 원본)
 * @property {string} normalizedName 비교용 정규화 이름
 * @property {number} requestedAmount 유저가 입력한 금액
 * @property {number} depositAmount 실제 입금해야 하는 고유 금액
 * @property {number} createdAt
 * @property {number} expiresAt
 */

/** @type {Map<number, DepositRequest>} depositAmount -> 요청 */
const pendingByAmount = new Map();

/** @type {Map<string, object>} token -> 승인 대기 항목 */
const pendingApprovals = new Map();

function now() {
  return Date.now();
}

/** 이름 비교용 정규화: 공백 제거, 소문자화. */
function normalizeName(name) {
  return String(name || '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** 만료된 요청/승인을 정리합니다. */
function pruneExpired() {
  const current = now();
  for (const [amount, request] of pendingByAmount) {
    if (request.expiresAt <= current) {
      pendingByAmount.delete(amount);
    }
  }
  for (const [token, approval] of pendingApprovals) {
    if (approval.expiresAt <= current) {
      pendingApprovals.delete(token);
    }
  }
}

/** 특정 유저의 기존 대기 요청을 모두 취소합니다. */
function cancelUserRequests(userId) {
  for (const [amount, request] of pendingByAmount) {
    if (request.userId === userId) {
      pendingByAmount.delete(amount);
    }
  }
}

/**
 * 충돌하지 않는 고유 입금 금액을 찾습니다.
 * base부터 시작해 필요하면 1~MAX_OFFSET원을 더해 봅니다.
 * @param {number} base
 * @returns {number | null}
 */
function findUniqueAmount(base) {
  if (!pendingByAmount.has(base)) {
    return base;
  }

  for (let offset = 1; offset <= MAX_OFFSET; offset += 1) {
    const candidate = base + offset;
    if (!pendingByAmount.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * 새로운 충전 요청을 생성합니다.
 * @param {string} userId
 * @param {string} username
 * @param {number} requestedAmount
 * @param {string} expectedName 입금자명
 * @returns {{ status: 'ok', request: DepositRequest } | { status: 'invalid' | 'invalid_name' | 'full' }}
 */
function createRequest(userId, username, requestedAmount, expectedName) {
  pruneExpired();

  if (!Number.isSafeInteger(requestedAmount) || requestedAmount <= 0) {
    return { status: 'invalid' };
  }

  const normalizedName = normalizeName(expectedName);
  if (normalizedName.length < 2) {
    return { status: 'invalid_name' };
  }

  // 같은 유저의 이전 요청은 새 요청으로 대체합니다.
  cancelUserRequests(userId);

  const depositAmount = findUniqueAmount(requestedAmount);
  if (depositAmount === null) {
    return { status: 'full' };
  }

  const createdAt = now();
  /** @type {DepositRequest} */
  const request = {
    userId,
    username,
    expectedName: String(expectedName).trim(),
    normalizedName,
    requestedAmount,
    depositAmount,
    createdAt,
    expiresAt: createdAt + REQUEST_TTL_MS,
  };

  pendingByAmount.set(depositAmount, request);
  return { status: 'ok', request };
}

/**
 * 입금된 금액과 일치하는 대기 요청을 찾아 소비합니다.
 * @param {number} amount
 * @returns {DepositRequest | null}
 */
function matchDeposit(amount) {
  pruneExpired();

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return null;
  }

  const request = pendingByAmount.get(amount);
  if (!request) {
    return null;
  }

  pendingByAmount.delete(amount);
  return request;
}

/**
 * 입금 알림에서 추출한 이름이 요청의 입금자명과 일치하는지 확인합니다.
 * 한쪽이 다른 쪽을 포함하기만 해도 일치로 봅니다(성/이름 일부 표기 차이 대응).
 * @param {DepositRequest} request
 * @param {string | null} detectedName
 * @returns {boolean}
 */
function isNameMatch(request, detectedName) {
  const detected = normalizeName(detectedName);
  if (!detected) return false;
  const expected = request.normalizedName;
  return detected.includes(expected) || expected.includes(detected);
}

/**
 * 관리자 승인 대기 항목을 생성합니다.
 * @param {object} data
 * @returns {string} token
 */
function createApproval(data) {
  pruneExpired();
  const token = crypto.randomBytes(8).toString('hex');
  pendingApprovals.set(token, {
    ...data,
    token,
    createdAt: now(),
    expiresAt: now() + APPROVAL_TTL_MS,
  });
  return token;
}

/**
 * 승인 대기 항목을 소비합니다(승인/거절 시 제거).
 * @param {string} token
 * @returns {object | null}
 */
function resolveApproval(token) {
  pruneExpired();
  const approval = pendingApprovals.get(token);
  if (!approval) return null;
  pendingApprovals.delete(token);
  return approval;
}

/** 현재 대기중인 요청 수 (진단용) */
function pendingCount() {
  pruneExpired();
  return pendingByAmount.size;
}

module.exports = {
  createRequest,
  matchDeposit,
  isNameMatch,
  createApproval,
  resolveApproval,
  cancelUserRequests,
  normalizeName,
  pendingCount,
  REQUEST_TTL_MS,
};
