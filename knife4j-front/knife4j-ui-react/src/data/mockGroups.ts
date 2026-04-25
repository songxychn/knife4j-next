// Mock multi-group data for TASK-014 development
// Each group represents one swagger document source
// Types are defined in GroupContext to avoid duplication

import type { ApiGroup } from '../context/GroupContext';

export const MOCK_GROUPS: ApiGroup[] = [
  {
    value: 'petstore',
    label: 'Petstore API (v1.0.11)',
    apis: [
      { key: '/group/petstore/updatePet', operationId: 'updatePet', tag: 'pet', method: 'PUT', path: '/pet', summary: 'Update an existing pet' },
      { key: '/group/petstore/addPet', operationId: 'addPet', tag: 'pet', method: 'POST', path: '/pet', summary: 'Add a new pet to the store' },
      { key: '/group/petstore/findPetsByStatus', operationId: 'findPetsByStatus', tag: 'pet', method: 'GET', path: '/pet/findByStatus', summary: 'Finds Pets by status' },
      { key: '/group/petstore/findPetsByTags', operationId: 'findPetsByTags', tag: 'pet', method: 'GET', path: '/pet/findByTags', summary: 'Finds Pets by tags' },
      { key: '/group/petstore/getPetById', operationId: 'getPetById', tag: 'pet', method: 'GET', path: '/pet/{petId}', summary: 'Find pet by ID' },
      { key: '/group/petstore/updatePetWithForm', operationId: 'updatePetWithForm', tag: 'pet', method: 'POST', path: '/pet/{petId}', summary: 'Updates a pet in the store with form data' },
      { key: '/group/petstore/deletePet', operationId: 'deletePet', tag: 'pet', method: 'DELETE', path: '/pet/{petId}', summary: 'Deletes a pet' },
      { key: '/group/petstore/uploadFile', operationId: 'uploadFile', tag: 'pet', method: 'POST', path: '/pet/{petId}/uploadImage', summary: 'Uploads an image' },
      { key: '/group/petstore/getInventory', operationId: 'getInventory', tag: 'store', method: 'GET', path: '/store/inventory', summary: 'Returns pet inventories by status' },
      { key: '/group/petstore/placeOrder', operationId: 'placeOrder', tag: 'store', method: 'POST', path: '/store/order', summary: 'Place an order for a pet' },
      { key: '/group/petstore/getOrderById', operationId: 'getOrderById', tag: 'store', method: 'GET', path: '/store/order/{orderId}', summary: 'Find purchase order by ID' },
      { key: '/group/petstore/deleteOrder', operationId: 'deleteOrder', tag: 'store', method: 'DELETE', path: '/store/order/{orderId}', summary: 'Delete purchase order by ID' },
      { key: '/group/petstore/createUser', operationId: 'createUser', tag: 'user', method: 'POST', path: '/user', summary: 'Create user' },
      { key: '/group/petstore/loginUser', operationId: 'loginUser', tag: 'user', method: 'GET', path: '/user/login', summary: 'Logs user into the system' },
      { key: '/group/petstore/logoutUser', operationId: 'logoutUser', tag: 'user', method: 'GET', path: '/user/logout', summary: 'Logs out current logged in user session' },
      { key: '/group/petstore/getUserByName', operationId: 'getUserByName', tag: 'user', method: 'GET', path: '/user/{username}', summary: 'Get user by user name' },
      { key: '/group/petstore/updateUser', operationId: 'updateUser', tag: 'user', method: 'PUT', path: '/user/{username}', summary: 'Update user' },
      { key: '/group/petstore/deleteUser', operationId: 'deleteUser', tag: 'user', method: 'DELETE', path: '/user/{username}', summary: 'Delete user' },
    ],
  },
  {
    value: 'order-service',
    label: 'Order Service (v2.0.0)',
    apis: [
      { key: '/group/order-service/listOrders', operationId: 'listOrders', tag: 'orders', method: 'GET', path: '/orders', summary: 'List all orders' },
      { key: '/group/order-service/createOrder', operationId: 'createOrder', tag: 'orders', method: 'POST', path: '/orders', summary: 'Create a new order' },
      { key: '/group/order-service/getOrder', operationId: 'getOrder', tag: 'orders', method: 'GET', path: '/orders/{id}', summary: 'Get order by ID' },
      { key: '/group/order-service/cancelOrder', operationId: 'cancelOrder', tag: 'orders', method: 'DELETE', path: '/orders/{id}', summary: 'Cancel an order' },
      { key: '/group/order-service/listProducts', operationId: 'listProducts', tag: 'products', method: 'GET', path: '/products', summary: 'List all products' },
      { key: '/group/order-service/getProduct', operationId: 'getProduct', tag: 'products', method: 'GET', path: '/products/{id}', summary: 'Get product by ID' },
    ],
  },
];
