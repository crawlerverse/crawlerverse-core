import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center space-y-8">
        <h1 className="text-5xl font-bold text-blue-400">Crawler</h1>
        <p className="text-xl text-gray-400">
          An AI-native roguelike where LLMs serve as dungeon master and adventurer.
        </p>

        <div className="space-y-4">
          <Link
            href="/play"
            className="inline-block px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors"
          >
            Play Demo
          </Link>
        </div>

        <div className="pt-8 text-sm text-gray-500">
          <p>Phase 0: Proof of Life</p>
          <p className="mt-2">
            <a
              href="https://github.com/reluctantfuturist/crawler-core"
              className="text-blue-400 hover:underline"
            >
              View on GitHub
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
