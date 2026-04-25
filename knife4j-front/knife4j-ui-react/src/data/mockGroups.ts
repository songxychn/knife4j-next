// Mock multi-group data for TASK-014 development
// Each group represents one swagger document source

export interface ApiItem {
  operationId: string;
  tag: string;
  method: string;
  path: string;
  summary: string;
}

export interface ApiGroup {
  value: string;
  label: string;
  apis: ApiItem[];
}

export const MOCK_GROUPS: ApiGroup[] = [
  {
    value: 'petstore',
    label: 'Petstore API (v1.0.11)',
    apis: [
      { operationId: 'updatePet', tag: 'pet', method: 'PUT', path: '/pet', summary: 'Update an existing pet' },
      { operationId: 'addPet', tag: 'pet', method: 'POST', path: '/pet', summary: 'Add a new pet to the store' },
      { operationId: 'findPetsByStatus', tag: 'pet', method: 'GET', path: '/pet/findByStatus', summary: 'Finds Pets by status' },
      { operationId: 'findPetsByTags', tag: 'pet', method: 'GET', path: '/pet/findByTags', summary: 'Finds Pets by tags' },
      { operationId: 'getPetById', tag: 'pet', method: 'GET', path: '/pet/{petId}', summary: 'Find pet by ID' },
      { operationId: 'updatePetWithForm', tag: 'pet', method: 'POST', path: '/pet/{petId}', summary: 'Updates a pet in the store with form data' },
      { operationId: 'deletePet', tag: 'pet', method: 'DELETE', path: '/pet/{petId}', summary: 'Deletes a pet' },
      { operationId: 'uploadFile', tag: 'pet', method: 'POST', path: '/pet/{petId}/uploadImage', summary: 'Uploads an image' },
      { operationId: 'getInventory', tag: 'store', method: 'GET', path: '/store/inventory', summary: 'Returns pet inventories by status' },
      { operationId: 'placeOrder', tag: 'store', method: 'POST', path: '/store/order', summary: 'Place an order for a pet' },
      { operationId: 'getOrderById', tag: 'store', method: 'GET', path: '/store/order/{orderId}', summary: 'Find purchase order by ID' },
      { operationId: 'deleteOrder', tag: 'store', method: 'DELETE', path: '/store/order/{orderId}', summary: 'Delete purchase order by ID' },
      { operationId: 'createUser', tag: 'user', method: 'POST', path: '/user', summary: 'Create user' },
      { operationId: 'createUsersWithListInput', tag: 'user', method: 'POST', path: '/user/createWithList', summary: 'Creates list of users with given input array' },
      { operationId: 'loginUser', tag: 'user', method: 'GET', path: '/user/login', summary: 'Logs user into the system' },
      { operationId: 'logoutUser', tag: 'user', method: 'GET', path: '/user/logout', summary: 'Logs out current logged in user session' },
      { operationId: 'getUserByName', tag: 'user', method: 'GET', path: '/user/{username}', summary: 'Get user by user name' },
      { operationId: 'updateUser', tag: 'user', method: 'PUT', path: '/user/{username}', summary: 'Update user' },
      { operationId: 'deleteUser', tag: 'user', method: 'DELETE', path: '/user/{username}', summary: 'Delete user' },
    ],
  },
  {
    value: 'order-service',
    label: 'Order Service (v2.0.0)',
    apis: [
      { operationId: 'listOrders', tag: 'orders', method: 'GET', path: '/orders', summary: 'List all orders' },
      { operationId: 'createOrder', tag: 'orders', method: 'POST', path: '/orders', summary: 'Create a new order' },
      { operationId: 'getOrder', tag: 'orders', method: 'GET', path: '/orders/{id}', summary: 'Get order by ID' },
      { operationId: 'cancelOrder', tag: 'orders', method: 'DELETE', path: '/orders/{id}', summary: 'Cancel an order' },
      { operationId: 'listProducts', tag: 'products', method: 'GET', path: '/products', summary: 'List all products' },
      { operationId: 'getProduct', tag: 'products', method: 'GET', path: '/products/{id}', summary: 'Get product by ID' },
    ],
  },
];
