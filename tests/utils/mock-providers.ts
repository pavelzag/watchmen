/**
 * Mock Providers Setup
 * 
 * This file centralizes mock providers for external services (GCP, Auth, upcoming AWS).
 * Import these in your tests to easily swap or mock the underlying cloud infrastructure.
 */

// Example placeholder for mocking cloud interactions
export const mockCloudProvider = {
    // Can be configured to simulate AWS ('aws') or GCP ('gcp')
    getCurrentProvider: () => process.env.CLOUD_PROVIDER || 'gcp',

    // Mocked storage responses
    storage: {
        upload: jest.fn().mockResolvedValue({ success: true }),
        download: jest.fn().mockResolvedValue(Buffer.from('mock-data')),
    },

    // Example abstraction to be implemented when AWS is added
    getInstances: jest.fn().mockResolvedValue([
        { id: 'mock-instance-1', status: 'RUNNING' }
    ])
};

// Helper to switch cloud environments in tests
export function setTestCloudEnvironment(provider: 'gcp' | 'aws') {
    process.env.CLOUD_PROVIDER = provider;
}
