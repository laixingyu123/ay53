/**
 * 第三方账号集合管理 API（LinuxDo、GitHub 等）
 * 接口前缀: /lyallaccount
 * 注意：与 /lyanyrouter 前缀的 AnyRouter 账号接口区分
 */

import apiClient, { handleApiResponse } from './client.js';

/**
 * 查询第三方账号列表
 * @description 查询第三方账号列表，支持多条件筛选。默认不分页遍历全部数据，设置 paginate=true 启用分页模式
 * @param {Object} [params={}] - 查询参数
 * @param {string} [params.account_type] - 账号类型筛选：'linuxdo' | 'github'
 * @param {boolean} [params.is_banned] - 是否封禁筛选
 * @param {boolean} [params.is_bindanyrouter] - 是否绑定AnyRouter筛选
 * @param {string} [params.bindanyrouter_username] - 绑定的AnyRouter用户名筛选
 * @param {boolean} [params.is_sold] - 是否出售筛选
 * @param {boolean} [params.paginate=false] - 是否启用分页模式
 * @param {number} [params.page=1] - 页码（分页模式下生效）
 * @param {number} [params.pageSize=20] - 每页条数（分页模式下生效）
 * @returns {Promise<{success: boolean, data?: {list: Array, total: number, page?: number, pageSize?: number}, error?: string}>}
 */
export async function getAllAccountList(params = {}) {
	const { account_type, is_banned, is_bindanyrouter, bindanyrouter_username, is_sold, paginate, page, pageSize } = params;

	// 验证 account_type（如果提供）
	if (account_type !== undefined && !['linuxdo', 'github'].includes(account_type)) {
		return {
			success: false,
			error: 'account_type 必须为 linuxdo 或 github',
		};
	}

	// 构建请求数据，只传有值的字段
	const requestData = {};
	if (account_type !== undefined) requestData.account_type = account_type;
	if (is_banned !== undefined) requestData.is_banned = is_banned;
	if (is_bindanyrouter !== undefined) requestData.is_bindanyrouter = is_bindanyrouter;
	if (bindanyrouter_username !== undefined) requestData.bindanyrouter_username = bindanyrouter_username;
	if (is_sold !== undefined) requestData.is_sold = is_sold;
	if (paginate !== undefined) requestData.paginate = paginate;
	if (page !== undefined) requestData.page = page;
	if (pageSize !== undefined) requestData.pageSize = pageSize;

	return handleApiResponse(apiClient.post('/lyallaccount/getAccountList', requestData));
}

/**
 * 查询单个第三方账号详情
 * @description 支持按 _id 或 username 查询，至少提供一个。按 username 查询时可指定 account_type 精确定位
 * @param {Object} params - 查询参数
 * @param {string} [params._id] - 记录ID
 * @param {string} [params.username] - 用户名
 * @param {string} [params.account_type] - 账号类型（按username查询时可指定）：'linuxdo' | 'github'
 * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
 */
export async function getAllAccountDetail(params) {
	const { _id, username, account_type } = params;

	if (!_id && !username) {
		return {
			success: false,
			error: '_id 和 username 至少提供一个',
		};
	}

	if (account_type !== undefined && !['linuxdo', 'github'].includes(account_type)) {
		return {
			success: false,
			error: 'account_type 必须为 linuxdo 或 github',
		};
	}

	const requestData = {};
	if (_id !== undefined) requestData._id = _id;
	if (username !== undefined) requestData.username = username;
	if (account_type !== undefined) requestData.account_type = account_type;

	return handleApiResponse(apiClient.post('/lyallaccount/getAccountDetail', requestData));
}

/**
 * 更新单个第三方账号信息
 * @description 支持按 _id 或 username 定位账号，至少提供一个。更新内容通过 data 字段传入
 * @param {Object} params - 请求参数
 * @param {string} [params._id] - 记录ID
 * @param {string} [params.username] - 用户名（用于定位账号）
 * @param {string} [params.account_type] - 账号类型（按username定位时可指定）：'linuxdo' | 'github'
 * @param {Object} params.data - 要更新的字段
 * @param {string} [params.data.username] - 账号名称
 * @param {string} [params.data.password] - 密码
 * @param {string} [params.data.twofa_secret] - 2FA密钥（Base32编码）
 * @param {string} [params.data.email] - 关联邮箱
 * @param {string} [params.data.email_bindqq] - 关联邮箱主QQ号
 * @param {string} [params.data.account_type] - 账号类型：'linuxdo' | 'github'
 * @param {string} [params.data.notes] - 备注
 * @param {boolean} [params.data.is_banned] - 是否封禁
 * @param {boolean} [params.data.is_bindanyrouter] - 是否绑定AnyRouter
 * @param {string} [params.data.bindanyrouter_username] - 绑定的AnyRouter用户名
 * @param {boolean} [params.data.is_sold] - 是否出售
 * @param {number} [params.data.sell_date] - 出售时间（时间戳）
 * @returns {Promise<{success: boolean, data?: {updated: number}, error?: string}>}
 */
export async function updateAllAccount(params) {
	const { _id, username, account_type, data } = params;

	if (!_id && !username) {
		return {
			success: false,
			error: '_id 和 username 至少提供一个',
		};
	}

	if (!data || Object.keys(data).length === 0) {
		return {
			success: false,
			error: '更新数据不能为空',
		};
	}

	if (account_type !== undefined && !['linuxdo', 'github'].includes(account_type)) {
		return {
			success: false,
			error: 'account_type 必须为 linuxdo 或 github',
		};
	}

	const requestData = { data };
	if (_id !== undefined) requestData._id = _id;
	if (username !== undefined) requestData.username = username;
	if (account_type !== undefined) requestData.account_type = account_type;

	return handleApiResponse(apiClient.post('/lyallaccount/updateAccount', requestData));
}

/**
 * 删除第三方账号
 * @description 支持按 _id 或 username 删除，至少提供一个。如果账号已绑定AnyRouter，会先自动解绑再删除
 * @param {Object} params - 请求参数
 * @param {string} [params._id] - 记录ID
 * @param {string} [params.username] - 用户名
 * @param {string} [params.account_type] - 账号类型（按username删除时可指定）：'linuxdo' | 'github'
 * @returns {Promise<{success: boolean, data?: {errCode: number, errMsg: string}, error?: string}>}
 */
export async function deleteAllAccount(params) {
	const { _id, username, account_type } = params;

	if (!_id && !username) {
		return {
			success: false,
			error: '_id 和 username 至少提供一个',
		};
	}

	if (account_type !== undefined && !['linuxdo', 'github'].includes(account_type)) {
		return {
			success: false,
			error: 'account_type 必须为 linuxdo 或 github',
		};
	}

	const requestData = {};
	if (_id !== undefined) requestData._id = _id;
	if (username !== undefined) requestData.username = username;
	if (account_type !== undefined) requestData.account_type = account_type;

	return handleApiResponse(apiClient.post('/lyallaccount/deleteAccount', requestData));
}

/**
 * 取消绑定AnyRouter
 * @description 取消账号的AnyRouter绑定，支持按 _id 或 username 定位账号，至少提供一个。
 * - GitHub账号：同时删除 anyr-accounts 中的对应记录（account_type=2）
 * - LinuxDo账号：清空 bindanyrouter_username 字段
 * @param {Object} params - 请求参数
 * @param {string} [params._id] - 记录ID
 * @param {string} [params.username] - 用户名
 * @returns {Promise<{success: boolean, data?: {errCode: number, errMsg: string, deleted?: number}, error?: string}>}
 */
export async function unbindAnyRouter(params) {
	const { _id, username } = params;

	if (!_id && !username) {
		return {
			success: false,
			error: '_id 和 username 至少提供一个',
		};
	}

	const requestData = {};
	if (_id !== undefined) requestData._id = _id;
	if (username !== undefined) requestData.username = username;

	return handleApiResponse(apiClient.post('/lyallaccount/unbindAnyRouter', requestData));
}

export default {
	getAllAccountList,
	getAllAccountDetail,
	updateAllAccount,
	deleteAllAccount,
	unbindAnyRouter,
};
