import { NextResponse } from 'next/server';
import { requireAccount, unauthorizedJson } from '@/lib/account';

export async function POST(req: Request) {
  try {
    await requireAccount();
    const body = await req.json().catch(() => ({}));
    const fix = typeof body.fix === 'string' ? body.fix.trim() : '';
    
    if (!fix) return NextResponse.json({ error: 'Fix content is required.' }, { status: 400 });
    
    // In a real implementation, we would:
    // 1. Fetch the user's GitHub token from the database
    // 2. Call GitHub API to create a branch
    // 3. Create or update lightcurve.config.json with the new rule
    // 4. Open a Pull Request
    
    // For this demo, we mock the success response with a fake PR URL
    const mockPrUrl = `https://github.com/uselightcurve/voice-agent/pull/${Math.floor(Math.random() * 1000) + 100}`;
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    return NextResponse.json({ success: true, prUrl: mockPrUrl }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to create PR', error);
    return NextResponse.json({ error: 'Failed to connect to GitHub.' }, { status: 500 });
  }
}
