import { act, render, screen } from '@testing-library/react';
import Navbar from './Navbar';
import { notifySelfManagedClustersChanged } from '@/lib/kubernetes/cluster-events';

// Mock dependencies
jest.mock('@/lib/auth', () => ({
    auth: jest.fn(),
    signOut: jest.fn(),
}));

jest.mock('@/lib/demo-mode', () => ({
    isDemoMode: jest.fn(() => false),
}));

jest.mock('@/lib/kubernetes/clusters', () => ({
    hasUserClusters: jest.fn(async () => false),
}));

jest.mock('next/navigation', () => ({
    useRouter: jest.fn(() => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() })),
    usePathname: jest.fn(() => '/dashboard'),
}));

jest.mock('next/link', () => {
    return ({ children, href, className }: { children: React.ReactNode, href: string, className?: string }) => {
        return (
            <a href={href} className={className}>
                {children}
            </a>
        );
    };
});

describe('Navbar', () => {
    const { auth } = require('@/lib/auth');
    const { isDemoMode } = require('@/lib/demo-mode');
    const { hasUserClusters } = require('@/lib/kubernetes/clusters');

    beforeEach(() => {
        jest.clearAllMocks();
        isDemoMode.mockReturnValue(false);
        hasUserClusters.mockResolvedValue(false);
    });

    it('renders the branding elements correctly', async () => {
        auth.mockResolvedValue(null); // No session

        const NavbarComponent = await Navbar();
        render(NavbarComponent);

        expect(screen.getByText('WATCHMEN')).toBeInTheDocument();
    });

    it('renders sign out button and user info when authenticated', async () => {
        auth.mockResolvedValue({
            user: {
                name: 'Test User',
                email: 'test@example.com',
                image: 'https://example.com/avatar.png',
            }
        });

        const NavbarComponent = await Navbar();
        render(NavbarComponent);

        expect(screen.getByText('test@example.com')).toBeInTheDocument();
        expect(screen.getByText('[LOGOUT]')).toBeInTheDocument();
    });

    it('renders core navigation links and hides SELF-MANAGED when no cluster is added', async () => {
        auth.mockResolvedValue({
            user: {
                name: 'Test User',
                email: 'test@example.com',
            }
        });
        hasUserClusters.mockResolvedValue(false);

        const NavbarComponent = await Navbar();
        render(NavbarComponent);

        expect(screen.getByText('FINDINGS')).toBeInTheDocument();
        expect(screen.getByText('HISTORY')).toBeInTheDocument();
        expect(screen.getByText('COMPLIANCE')).toBeInTheDocument();
        expect(screen.getByText('SETTINGS')).toBeInTheDocument();
        expect(screen.queryByText('SELF-MANAGED')).not.toBeInTheDocument();
    });

    it('shows SELF-MANAGED tab when a self-managed cluster is added and found', async () => {
        auth.mockResolvedValue({
            user: {
                name: 'Test User',
                email: 'test@example.com',
            }
        });
        hasUserClusters.mockResolvedValue(true);

        const NavbarComponent = await Navbar();
        render(NavbarComponent);

        expect(hasUserClusters).toHaveBeenCalledWith('test@example.com');
        expect(screen.getByText('SELF-MANAGED')).toBeInTheDocument();
    });

    it('shows SELF-MANAGED tab in demo mode', async () => {
        auth.mockResolvedValue({
            isDemoUser: true,
            user: {
                name: 'Demo User',
                email: 'demo@watchmen.dev',
            }
        });

        const NavbarComponent = await Navbar();
        render(NavbarComponent);

        expect(screen.getByText('SELF-MANAGED')).toBeInTheDocument();
    });

    it('dynamically toggles SELF-MANAGED tab when clusters change in Settings', async () => {
        auth.mockResolvedValue({
            user: {
                name: 'Test User',
                email: 'test@example.com',
            }
        });
        hasUserClusters.mockResolvedValue(false);

        const NavbarComponent = await Navbar();
        render(NavbarComponent);

        expect(screen.queryByText('SELF-MANAGED')).not.toBeInTheDocument();

        act(() => {
            notifySelfManagedClustersChanged(true);
        });
        expect(screen.getByText('SELF-MANAGED')).toBeInTheDocument();

        act(() => {
            notifySelfManagedClustersChanged(false);
        });
        expect(screen.queryByText('SELF-MANAGED')).not.toBeInTheDocument();
    });
});
