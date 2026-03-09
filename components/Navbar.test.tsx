import { render, screen } from '@testing-library/react';
import Navbar from './Navbar';

// Mock dependencies
jest.mock('@/lib/auth', () => ({
    auth: jest.fn(),
    signOut: jest.fn(),
}));

jest.mock('next/navigation', () => ({
    useRouter: jest.fn(() => ({ push: jest.fn(), replace: jest.fn() })),
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

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders the branding elements correctly', async () => {
        auth.mockResolvedValue(null); // No session

        // Navbar is an async component, so we must await resolving it in test or mock it.
        // However, since React 18 / Next 15 Server Components, testing async components directly in RTL 
        // requires a workaround or rendering the awaited component.
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

    it('renders all navigation links', async () => {
        auth.mockResolvedValue(null);

        const NavbarComponent = await Navbar();
        render(NavbarComponent);

        expect(screen.getByText('FINDINGS')).toBeInTheDocument();
        expect(screen.getByText('HISTORY')).toBeInTheDocument();
        expect(screen.getByText('COMPLIANCE')).toBeInTheDocument();
        expect(screen.getByText('SETTINGS')).toBeInTheDocument();
    });
});
