/**
 * AnyRouter 系统令牌签到模块
 * 使用 system_token (Access Token) + account_id 通过纯 HTTP 请求进行签到
 * 自动处理阿里云 CDN acw_sc__v2 JS 挑战
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { addKeys, updateKeyInfo } from '../api/index.js';

// ============ acw_sc__v2 挑战破解 ============

const ACW_ORDER = [
	15, 35, 29, 24, 33, 16, 1, 38, 10, 9, 19, 31, 40, 27, 22, 23, 25, 13, 6,
	11, 39, 18, 20, 8, 14, 21, 32, 26, 2, 30, 7, 4, 17, 5, 3, 28, 34, 37, 12,
	36,
];

/**
 * 从挑战页面 JS 中动态提取 key
 * @param {string} html - 挑战页面 HTML
 * @returns {string} key 字符串
 */
function extractAcwKey(html) {
	const arrMatch = html.match(/var N=\[([^\]]+)\]/);
	if (!arrMatch) throw new Error('无法提取混淆数组');
	const arr = arrMatch[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));

	const targetMatch = html.match(/\}\(a0i,\s*(0x[0-9a-f]+)\)/);
	if (!targetMatch) throw new Error('无法提取旋转目标值');
	const target = parseInt(targetMatch[1], 16);

	const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
	function decode(encoded) {
		let n = '';
		for (let q = 0, r = 0, s, t = 0; (s = encoded.charAt(t++)); ) {
			s = charset.indexOf(s);
			if (~s) {
				r = q % 4 ? r * 64 + s : s;
				if (q++ % 4) {
					n += String.fromCharCode(255 & (r >> ((-2 * q) & 6)));
				}
			}
		}
		let o = '';
		for (let u = 0; u < n.length; u++) {
			o += '%' + ('00' + n.charCodeAt(u).toString(16)).slice(-2);
		}
		return decodeURIComponent(o);
	}

	const rotateMatch = html.match(
		/try\{var e=([-+*\/()parseInt\w\s\(\)]*?);if\(e===c\)/
	);
	if (!rotateMatch) throw new Error('无法提取旋转表达式');
	const expr = rotateMatch[1];

	const hexIndices = [...expr.matchAll(/\(0x([0-9a-f]+)\)/g)].map((m) =>
		parseInt(m[1], 16)
	);

	const baseIdx = 0xfb;
	for (let attempt = 0; attempt < arr.length * 2; attempt++) {
		try {
			const currentArr = [...arr];
			const decodeIdx = (idx) => decode(currentArr[idx - baseIdx]);

			let result = expr;
			for (const hexIdx of hexIndices) {
				const decoded = decodeIdx(hexIdx);
				result = result.replace(`G(0x${hexIdx.toString(16)})`, `"${decoded}"`);
			}

			result = result.replace(
				/parseInt\("([^"]+)"\)/g,
				(_, s) => `parseInt("${s}")`
			);
			const computed = Function(`return ${result}`)();
			if (computed === target) break;
			arr.push(arr.shift());
		} catch {
			arr.push(arr.shift());
		}
	}

	const keyIdx = 0x115 - baseIdx;
	if (keyIdx < 0 || keyIdx >= arr.length) {
		throw new Error(`key 索引 ${keyIdx} 超出范围`);
	}
	return decode(arr[keyIdx]);
}

/**
 * 根据 arg1 和 key 计算 acw_sc__v2 cookie 值
 */
function computeAcwCookie(arg1, key) {
	const reordered = new Array(ACW_ORDER.length);
	for (let i = 0; i < arg1.length; i++) {
		for (let j = 0; j < ACW_ORDER.length; j++) {
			if (ACW_ORDER[j] === i + 1) {
				reordered[j] = arg1[i];
				break;
			}
		}
	}
	const joined = reordered.join('');

	let result = '';
	for (let i = 0; i < joined.length && i < key.length; i += 2) {
		const a = parseInt(joined.substring(i, i + 2), 16);
		const b = parseInt(key.substring(i, i + 2), 16);
		let h = (a ^ b).toString(16);
		if (h.length === 1) h = '0' + h;
		result += h;
	}
	return result;
}

// ============ HTTP 请求封装 ============

/**
 * 发送 HTTP 请求（自动检测代理）
 */
function request(url, options = {}) {
	return new Promise((resolve, reject) => {
		const parsed = new URL(url);
		const headers = {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
			Accept: '*/*',
			'Accept-Encoding': 'gzip, deflate',
			...options.headers,
		};

		const proxyUrl =
			process.env.HTTPS_PROXY ||
			process.env.https_proxy ||
			process.env.HTTP_PROXY ||
			process.env.http_proxy;

		const handleResponse = (res) => {
			const chunks = [];
			const encoding = res.headers['content-encoding'];
			let stream = res;
			if (encoding === 'gzip') {
				stream = res.pipe(zlib.createGunzip());
			} else if (encoding === 'deflate') {
				stream = res.pipe(zlib.createInflate());
			}

			stream.on('data', (chunk) => chunks.push(chunk));
			stream.on('end', () => {
				resolve({
					statusCode: res.statusCode,
					headers: res.headers,
					body: Buffer.concat(chunks).toString('utf-8'),
				});
			});
			stream.on('error', reject);
		};

		if (proxyUrl && parsed.protocol === 'https:') {
			const proxy = new URL(proxyUrl);
			const connectReq = http.request({
				hostname: proxy.hostname,
				port: proxy.port,
				method: 'CONNECT',
				path: `${parsed.hostname}:${parsed.port || 443}`,
				headers: { Host: `${parsed.hostname}:${parsed.port || 443}` },
			});

			connectReq.on('connect', (res, socket) => {
				if (res.statusCode !== 200) {
					reject(new Error(`代理 CONNECT 失败: ${res.statusCode}`));
					return;
				}
				const req = https.request(
					{
						hostname: parsed.hostname,
						path: parsed.pathname + parsed.search,
						method: options.method || 'GET',
						headers,
						socket,
						agent: false,
					},
					handleResponse
				);
				req.on('error', reject);
				if (options.body) req.write(options.body);
				req.end();
			});

			connectReq.on('error', reject);
			connectReq.end();
		} else {
			const client = parsed.protocol === 'https:' ? https : http;
			const req = client.request(
				{
					hostname: parsed.hostname,
					port: parsed.port,
					path: parsed.pathname + parsed.search,
					method: options.method || 'GET',
					headers,
				},
				handleResponse
			);
			req.on('error', reject);
			if (options.body) req.write(options.body);
			req.end();
		}
	});
}

// ============ 系统令牌签到模块 ============

class AnyRouterSystemTokenSignIn {
	constructor(baseUrl = 'https://anyrouter.top') {
		this.baseUrl = baseUrl;
		this.cookie = null;
		this.cookieExpireAt = 0;
	}

	/**
	 * 获取/刷新 acw_sc__v2 cookie
	 */
	async refreshCookie() {
		const now = Date.now();
		if (this.cookie && now < this.cookieExpireAt) {
			return;
		}

		console.log('[Cookie] 获取 acw_sc__v2 cookie...');
		const res = await request(this.baseUrl);

		const match = res.body.match(/var arg1='([A-F0-9]+)'/);
		if (!match) {
			if (res.body.includes('"success"')) {
				this.cookie = '';
				this.cookieExpireAt = now + 55 * 60 * 1000;
				console.log('[Cookie] 无需 CDN 挑战');
				return;
			}
			throw new Error('无法从挑战页面提取 arg1');
		}

		const arg1 = match[1];
		const key = extractAcwKey(res.body);
		this.cookie = `acw_sc__v2=${computeAcwCookie(arg1, key)}`;
		this.cookieExpireAt = now + 55 * 60 * 1000;
		console.log(`[Cookie] 已刷新，有效至 ${new Date(this.cookieExpireAt).toLocaleString()}`);
	}

	/**
	 * 发送 API 请求
	 * @param {string} path - API 路径
	 * @param {string} systemToken - 系统令牌
	 * @param {string} apiUser - 用户 ID
	 * @param {Object} options - { method, body, query }
	 * @returns {Object} JSON 响应
	 */
	async api(path, systemToken, apiUser, options = {}) {
		await this.refreshCookie();

		let url = `${this.baseUrl}${path}`;
		if (options.query) {
			const params = new URLSearchParams(options.query).toString();
			url += `?${params}`;
		}

		const headers = {
			Authorization: systemToken,
			'New-Api-User': String(apiUser),
			Cookie: this.cookie,
		};

		if (options.body) {
			headers['Content-Type'] = 'application/json';
		}

		const res = await request(url, {
			method: options.method || 'GET',
			headers,
			body: options.body ? JSON.stringify(options.body) : undefined,
		});

		console.log(`[API] ${options.method || 'GET'} ${path} -> HTTP ${res.statusCode}`);

		// 如果遇到挑战页面，清除 cookie 重试一次
		if (res.body.includes('acw_sc__v2') && !res.body.includes('"success"')) {
			console.log('[Cookie] 已失效，重新获取...');
			this.cookie = null;
			this.cookieExpireAt = 0;
			return this.api(path, systemToken, apiUser, options);
		}

		try {
			return JSON.parse(res.body);
		} catch {
			throw new Error(`API 响应解析失败: ${res.body.substring(0, 200)}`);
		}
	}

	/**
	 * 获取令牌列表
	 */
	async getTokens(systemToken, apiUser) {
		try {
			console.log('[令牌] 获取令牌列表...');
			const data = await this.api('/api/token/', systemToken, apiUser, {
				query: { p: 0, size: 100 },
			});

			if (data.success) {
				const tokens = data.data || [];
				console.log(`[信息] 获取到 ${tokens.length} 个令牌`);
				return tokens;
			}

			console.log(`[失败] 获取令牌列表失败: ${data.message || '未知错误'}`);
			return [];
		} catch (error) {
			console.log(`[失败] 获取令牌列表时发生错误: ${error.message}`);
			return [];
		}
	}

	/**
	 * 删除令牌
	 */
	async deleteToken(systemToken, apiUser, tokenId) {
		try {
			console.log(`[令牌] 删除令牌 ID: ${tokenId}...`);
			const data = await this.api(`/api/token/${tokenId}`, systemToken, apiUser, {
				method: 'DELETE',
			});

			if (data.success) {
				console.log(`[成功] 令牌 ${tokenId} 删除成功`);
				return true;
			}

			console.log(`[失败] 删除令牌失败: ${data.message || '未知错误'}`);
			return false;
		} catch (error) {
			console.log(`[失败] 删除令牌时发生错误: ${error.message}`);
			return false;
		}
	}

	/**
	 * 创建新令牌
	 */
	async createToken(systemToken, apiUser, tokenConfig = {}) {
		try {
			console.log('[令牌] 创建新令牌...');

			const requestBody = {
				name: tokenConfig.name || 'dw',
				expired_time: -1,
				model_limits_enabled: false,
				model_limits: '',
				allow_ips: '',
				group: 'default',
			};

			if (tokenConfig.unlimited_quota) {
				requestBody.unlimited_quota = true;
			} else {
				requestBody.remain_quota = tokenConfig.remain_quota || 500000;
			}

			const data = await this.api('/api/token/', systemToken, apiUser, {
				method: 'POST',
				body: requestBody,
			});

			if (data.success) {
				console.log('[成功] 令牌创建成功');
				return true;
			}

			console.log(`[失败] 创建令牌失败: ${data.message || '未知错误'}`);
			return false;
		} catch (error) {
			console.log(`[失败] 创建令牌时发生错误: ${error.message}`);
			return false;
		}
	}

	/**
	 * 更新令牌信息
	 */
	async updateToken(systemToken, apiUser, tokenData) {
		try {
			console.log(`[令牌] 更新令牌 ID: ${tokenData.id}...`);
			const data = await this.api('/api/token/', systemToken, apiUser, {
				method: 'PUT',
				body: tokenData,
			});

			if (data.success) {
				console.log(`[成功] 令牌 ${tokenData.id} 更新成功`);
				return data.data;
			}

			console.log(`[失败] 更新令牌失败: ${data.message || '未知错误'}`);
			return null;
		} catch (error) {
			console.log(`[失败] 更新令牌时发生错误: ${error.message}`);
			return null;
		}
	}

	/**
	 * 使用系统令牌获取用户信息并管理令牌（跳过 sign_in，该端点不支持 token 认证）
	 * @param {string} systemToken - 系统访问令牌 (Access Token)
	 * @param {string} apiUser - 用户 ID
	 * @param {Object} accountInfo - 账号信息（可选，用于令牌管理）
	 * @returns {Object} - 结果 { success: boolean, userInfo: object }
	 */
	async signIn(systemToken, apiUser, accountInfo = null) {
		apiUser = String(apiUser);
		console.log(`\n[系统令牌] 开始处理 (API User: ${apiUser})`);

		try {
			// 获取用户信息
			console.log('[网络] 获取用户信息...');
			const selfData = await this.api('/api/user/self', systemToken, apiUser);

			if (!selfData.success || !selfData.data) {
				console.log(`[失败] 获取用户信息失败: ${JSON.stringify(selfData)}`);
				return { success: false, error: '系统令牌认证失败或获取用户信息失败' };
			}

			const userData = selfData.data;
			const userInfo = {
				username: userData.username,
				email: userData.email,
				quota: userData.quota,
				usedQuota: userData.used_quota,
				affCode: userData.aff_code,
				affQuota: userData.aff_quota || 0,
				status: userData.status,
			};

			// 检查账号是否被封禁
			if (userInfo.status === 2) {
				console.log(`[警告] 账号 ${userInfo.username} 已被封禁 (status=2)`);
				return { success: true, userInfo };
			}

			console.log(`[信息] 用户名: ${userInfo.username}`);
			console.log(`[信息] 邮箱: ${userInfo.email}`);
			console.log(`[信息] 余额: $${(userInfo.quota / 500000).toFixed(2)}`);
			console.log(`[信息] 已使用: $${(userInfo.usedQuota / 500000).toFixed(2)}`);
			console.log(`[信息] 推广码: ${userInfo.affCode}`);

			// 检查是否有邀请奖励需要划转
			if (userInfo.affQuota && userInfo.affQuota > 0) {
				console.log(`[信息] 检测到邀请奖励: $${(userInfo.affQuota / 500000).toFixed(2)}`);
				console.log('[处理中] 开始划转邀请奖励到余额...');

				try {
					const transferData = await this.api('/api/user/aff_transfer', systemToken, apiUser, {
						method: 'POST',
						body: { quota: userInfo.affQuota },
					});

					userInfo.quota = userInfo.quota + userInfo.affQuota;
					userInfo.affQuota = 0;

					if (transferData.success) {
						console.log('[成功] 划转成功!');
						console.log(`[信息] 划转后余额: $${(userInfo.quota / 500000).toFixed(2)}`);
					} else {
						console.log(`[失败] 划转失败: ${transferData.message || '未知错误'}`);
					}
				} catch (error) {
					userInfo.quota = userInfo.quota + userInfo.affQuota;
					userInfo.affQuota = 0;
					console.log(`[失败] 划转失败: ${error.message}`);
				}
			}

			// 收集本次待创建的出售令牌名称
			const pendingSellTokenNames = [];

			// 根据账号配置管理令牌
			if (accountInfo && accountInfo.tokens && Array.isArray(accountInfo.tokens)) {
				console.log(
					`[令牌管理] 发现账号配置中有 ${accountInfo.tokens.length} 个令牌配置，开始处理...`
				);

				for (const tokenConfig of accountInfo.tokens) {
					if (tokenConfig.id && tokenConfig.is_deleted) {
						console.log(`[令牌管理] 准备删除令牌 ID: ${tokenConfig.id}`);
						await this.deleteToken(systemToken, apiUser, tokenConfig.id);
					} else if (!tokenConfig.id) {
						console.log('[令牌管理] 准备创建新令牌');
						const createSuccess = await this.createToken(systemToken, apiUser, {
							unlimited_quota: tokenConfig.unlimited_quota || false,
							remain_quota: tokenConfig.remain_quota,
							name: tokenConfig.name,
						});

						if (createSuccess && tokenConfig.name && tokenConfig.name.startsWith('出售_')) {
							pendingSellTokenNames.push({
								name: tokenConfig.name,
								remain_quota: tokenConfig.remain_quota,
							});
						}
					}
				}

				console.log('[令牌管理] 令牌管理完成');
			}

			// 获取令牌信息
			let tokens = await this.getTokens(systemToken, apiUser);

			// 如果没有令牌，先创建一个
			if (tokens.length === 0) {
				const created = await this.createToken(systemToken, apiUser, { unlimited_quota: true });
				if (created) {
					tokens = await this.getTokens(systemToken, apiUser);
				}
			} else {
				// 补充令牌额度
				if (accountInfo && accountInfo.tokens && Array.isArray(accountInfo.tokens)) {
					const tokensToSupplement = accountInfo.tokens.filter(
						(t) => t.supplement_quota && t.supplement_quota > 0
					);

					if (tokensToSupplement.length > 0) {
						console.log(`[令牌管理] 发现 ${tokensToSupplement.length} 个令牌需要补充额度`);

						for (const configToken of tokensToSupplement) {
							const matchedToken = tokens.find((t) => t.id === configToken.id);
							if (matchedToken) {
								const newRemainQuota =
									(matchedToken.remain_quota || 0) + configToken.supplement_quota;
								console.log(
									`[令牌管理] 令牌 ${matchedToken.id} 补充额度: ${configToken.supplement_quota} -> 新额度: ${newRemainQuota}`
								);

								const updatedTokenData = {
									...matchedToken,
									remain_quota: newRemainQuota,
								};

								const updateResult = await this.updateToken(systemToken, apiUser, updatedTokenData);
								if (updateResult) {
									matchedToken.remain_quota = updateResult.remain_quota;
									console.log(
										`[令牌管理] 令牌 ${matchedToken.id} 额度补充成功，当前额度: ${updateResult.remain_quota}`
									);

									if (configToken.key) {
										const keyUpdateResult = await updateKeyInfo({
											key: configToken.key,
											incData: {
												quota: configToken.supplement_quota / 500000,
											},
											updateData: {
												remain_quota: updateResult.remain_quota / 500000,
												used_quota: (updateResult.used_quota || 0) / 500000,
												quota_update_date: Date.now(),
											},
										});

										if (keyUpdateResult.success) {
											console.log('[令牌管理] 服务端 Key 信息同步成功');
										} else {
											console.log(
												`[令牌管理] 服务端 Key 信息同步失败: ${keyUpdateResult.error}`
											);
										}
									}
								}
							} else {
								console.log(`[令牌管理] 未找到ID为 ${configToken.id} 的令牌，跳过补充`);
							}
						}
					}
				}
			}

			// 如果有待上传的出售令牌，批量上传到服务器
			if (pendingSellTokenNames.length > 0) {
				console.log(
					`[令牌管理] 检测到 ${pendingSellTokenNames.length} 个出售令牌，准备批量上传...`
				);

				const keysToUpload = [];
				for (const pending of pendingSellTokenNames) {
					const matchedToken = tokens.find((t) => t.name === pending.name);
					if (matchedToken && matchedToken.key) {
						const quota = pending.remain_quota ? pending.remain_quota / 500000 : 0;
						keysToUpload.push({
							key: matchedToken.key,
							key_type: 'anyrouter',
							is_sold: false,
							quota: quota,
							source_name: `${accountInfo.username || ''}&${pending.name}`,
							account_id: accountInfo._id,
						});
					}
				}

				if (keysToUpload.length > 0) {
					const uploadResult = await addKeys(keysToUpload);
					if (uploadResult.success) {
						console.log(`[令牌管理] 批量上传成功，共 ${keysToUpload.length} 个Key`);
					} else {
						console.log(`[令牌管理] 批量上传失败: ${uploadResult.error}`);
					}
				}
			}

			// 检测出售令牌的已使用额度是否有变化
			if (accountInfo && accountInfo.tokens && Array.isArray(accountInfo.tokens)) {
				const sellTokenConfigs = accountInfo.tokens.filter(
					(t) => ((t.name && t.name.startsWith('出售_')) || t.is_sold === true) && t.key
				);

				for (const configToken of sellTokenConfigs) {
					const currentToken = tokens.find(
						(t) => t.key === configToken.key || t.id === configToken.id
					);

					if (currentToken) {
						const oldUsedQuota = configToken.used_quota || 0;
						const newUsedQuota = currentToken.used_quota || 0;
						const isSold = configToken.is_sold === true;

						if (newUsedQuota !== oldUsedQuota || isSold) {
							const logPrefix = isSold
								? `[令牌管理] 已售出令牌 ${configToken.name}`
								: `[令牌管理] 出售令牌 ${configToken.name}`;

							if (newUsedQuota !== oldUsedQuota) {
								console.log(
									`${logPrefix} 已使用额度变化: ${oldUsedQuota} -> ${newUsedQuota}`
								);
							} else {
								console.log(`${logPrefix} 强制更新额度信息`);
							}

							const keyUpdateResult = await updateKeyInfo({
								key: configToken.key,
								updateData: {
									remain_quota: (currentToken.remain_quota || 0) / 500000,
									used_quota: newUsedQuota / 500000,
									quota_update_date: Date.now(),
								},
							});

							if (keyUpdateResult.success) {
								console.log(`${logPrefix} 服务端信息同步成功`);
							} else {
								console.log(`${logPrefix} 服务端信息同步失败: ${keyUpdateResult.error}`);
							}
						}
					}
				}
			}

			// 过滤令牌数据，只保留需要的字段
			if (tokens.length > 0) {
				userInfo.tokens = tokens.map((token) => ({
					id: token.id,
					key: token.key,
					name: token.name,
					unlimited_quota: token.unlimited_quota,
					used_quota: token.used_quota,
					remain_quota: token.remain_quota,
					supplement_quota: 0,
					status: token.status,
				}));
				console.log(`[信息] 成功获取 ${userInfo.tokens.length} 个令牌信息`);
			}

			return { success: true, userInfo };
		} catch (error) {
			console.log('[失败] 签到过程中发生错误:');
			console.log(`[错误] 消息: ${error.message}`);
			console.log('[错误] 堆栈:', error.stack);
			return { success: false, error: error.message };
		}
	}
}

export default AnyRouterSystemTokenSignIn;

// 如果直接运行此文件，执行签到测试
const isMainModule = fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
	(async () => {
		const signer = new AnyRouterSystemTokenSignIn();

		console.log('===== AnyRouter 系统令牌签到测试 =====\n');

		const systemToken = process.argv[2] || '';
		const apiUser = process.argv[3] || '';

		if (!systemToken || !apiUser) {
			console.log('[错误] 请提供 system_token 和 api_user 参数');
			console.log('用法：node checkin-system-token.js <system_token> <api_user>');
			process.exit(1);
		}

		const result = await signer.signIn(systemToken, apiUser);

		if (result && result.success) {
			console.log('\n===== 签到成功 =====');
			if (result.userInfo) {
				console.log(`用户名: ${result.userInfo.username}`);
				console.log(`余额: $${(result.userInfo.quota / 500000).toFixed(2)}`);
			}
		} else {
			console.log('\n===== 签到失败 =====');
			if (result && result.error) {
				console.log(`错误: ${result.error}`);
			}
		}
	})();
}
