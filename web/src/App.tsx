import { Outlet, NavLink } from "react-router-dom";
import { useChainStore } from "./store/chainStore";
import { useParachainProvider } from "./hooks/useParachainProvider";
import { formatDot } from "./utils/format";
import { WalletPicker } from "./components/WalletPicker";

export default function App() {
	const account = useChainStore((s) => s.account);
	const balance = useChainStore((s) => s.balance);
	const connected = useChainStore((s) => s.connected);

	useParachainProvider();

	const navLinkClass = ({ isActive }: { isActive: boolean }) =>
		`relative px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap ${
			isActive
				? "text-white"
				: "text-text-secondary hover:text-text-primary hover:bg-white/[0.04]"
		}`;

	return (
		<div className="min-h-screen bg-pattern relative">
			<div
				className="gradient-orb"
				style={{ background: "#e6007a", top: "-200px", right: "-100px" }}
			/>
			<div
				className="gradient-orb"
				style={{ background: "#4cc2ff", bottom: "-200px", left: "-100px" }}
			/>

			<nav className="sticky top-0 z-50 border-b border-white/[0.06] backdrop-blur-xl bg-surface-950/80">
				<div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-6">
					<span className="text-base font-semibold text-text-primary font-display tracking-tight shrink-0">
						ppview
					</span>

					<div className="flex gap-0.5 overflow-x-auto">
						<NavLink to="/" end className={navLinkClass}>
							{({ isActive }) => (
								<>
									{isActive && (
										<span className="absolute inset-0 rounded-lg bg-polka-500/15 border border-polka-500/25" />
									)}
									<span className="relative">Browse</span>
								</>
							)}
						</NavLink>
						<NavLink to="/purchases" className={navLinkClass}>
							{({ isActive }) => (
								<>
									{isActive && (
										<span className="absolute inset-0 rounded-lg bg-polka-500/15 border border-polka-500/25" />
									)}
									<span className="relative">My Purchases</span>
								</>
							)}
						</NavLink>
						<NavLink to="/upload" className={navLinkClass}>
							{({ isActive }) => (
								<>
									{isActive && (
										<span className="absolute inset-0 rounded-lg bg-polka-500/15 border border-polka-500/25" />
									)}
									<span className="relative">Upload</span>
								</>
							)}
						</NavLink>
					</div>

					<div className="ml-auto flex items-center gap-2 shrink-0">
						<span
							className={`w-2 h-2 rounded-full transition-colors duration-500 ${
								connected
									? "bg-accent-green shadow-[0_0_6px_rgba(52,211,153,0.5)]"
									: "bg-text-muted"
							}`}
						/>
						<WalletPicker />
						{account && (
							<span className="text-xs text-text-tertiary font-mono">
								{formatDot(balance)}
							</span>
						)}
					</div>
				</div>
			</nav>

			<main className="relative z-10 max-w-5xl mx-auto px-4 py-8">
				<Outlet />
			</main>
		</div>
	);
}
