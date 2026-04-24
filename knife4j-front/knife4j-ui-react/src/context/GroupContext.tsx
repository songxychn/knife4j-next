import React, { createContext, useContext, useState } from 'react';

export interface ApiItem {
  key: string;
  method: string;
  path: string;
  summary: string;
  tag: string;
}

export interface ApiGroup {
  value: string;
  label: string;
  apis: ApiItem[];
}

// Mock data: two swagger document sources
const MOCK_GROUPS: ApiGroup[] = [
  {
    value: 'petstore',
    label: 'Petstore API (v3)',
    apis: [
      { key: '/group/petstore/pet/findByStatus', method: 'GET', path: '/pet/findByStatus', summary: '按状态查询宠物', tag: 'pet' },
      { key: '/group/petstore/pet/findByTags', method: 'GET', path: '/pet/findByTags', summary: '按标签查询宠物', tag: 'pet' },
      { key: '/group/petstore/pet', method: 'POST', path: '/pet', summary: '新增宠物', tag: 'pet' },
      { key: '/group/petstore/pet/update', method: 'PUT', path: '/pet', summary: '更新宠物信息', tag: 'pet' },
      { key: '/group/petstore/store/inventory', method: 'GET', path: '/store/inventory', summary: '查询库存', tag: 'store' },
      { key: '/group/petstore/store/order', method: 'POST', path: '/store/order', summary: '下单', tag: 'store' },
      { key: '/group/petstore/user/login', method: 'GET', path: '/user/login', summary: '用户登录', tag: 'user' },
      { key: '/group/petstore/user/logout', method: 'GET', path: '/user/logout', summary: '用户登出', tag: 'user' },
      { key: '/group/petstore/user', method: 'POST', path: '/user', summary: '创建用户', tag: 'user' },
    ],
  },
  {
    value: 'admin',
    label: '管理后台 API (v1)',
    apis: [
      { key: '/group/admin/users', method: 'GET', path: '/admin/users', summary: '获取用户列表', tag: '用户管理' },
      { key: '/group/admin/users/create', method: 'POST', path: '/admin/users', summary: '创建用户', tag: '用户管理' },
      { key: '/group/admin/users/delete', method: 'DELETE', path: '/admin/users/{id}', summary: '删除用户', tag: '用户管理' },
      { key: '/group/admin/roles', method: 'GET', path: '/admin/roles', summary: '获取角色列表', tag: '角色管理' },
      { key: '/group/admin/roles/assign', method: 'POST', path: '/admin/roles/assign', summary: '分配角色', tag: '角色管理' },
      { key: '/group/admin/logs', method: 'GET', path: '/admin/logs', summary: '操作日志', tag: '系统' },
    ],
  },
];

interface GroupContextValue {
  groups: ApiGroup[];
  activeGroup: ApiGroup;
  setActiveGroupValue: (value: string) => void;
}

const GroupContext = createContext<GroupContextValue | null>(null);

export const GroupProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeGroupValue, setActiveGroupValue] = useState(MOCK_GROUPS[0].value);
  const activeGroup = MOCK_GROUPS.find((g) => g.value === activeGroupValue) ?? MOCK_GROUPS[0];

  return (
    <GroupContext.Provider value={{ groups: MOCK_GROUPS, activeGroup, setActiveGroupValue }}>
      {children}
    </GroupContext.Provider>
  );
};

export const useGroup = (): GroupContextValue => {
  const ctx = useContext(GroupContext);
  if (!ctx) throw new Error('useGroup must be used inside GroupProvider');
  return ctx;
};
