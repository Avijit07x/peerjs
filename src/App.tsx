import Peer, { type DataConnection } from "peerjs";
import { useEffect, useMemo, useRef, useState } from "react";

type Meta = {
	type: "meta";
	name: string;
	size: number;
	mime: string;
	chunkSize: number;
};
type Chunk = { type: "chunk"; index: number; payload: ArrayBuffer };
type Eof = { type: "eof" };
type Ack = { type: "ack"; index: number };

type IncomingMessage = Meta | Chunk | Eof | Ack;

export default function App() {
	const [myId, setMyId] = useState("");
	const [remoteId, setRemoteId] = useState("");
	const [status, setStatus] = useState("Idle");
	const [connected, setConnected] = useState(false);
	const [conn, setConn] = useState<DataConnection | null>(null);
	const [file, setFile] = useState<File | null>(null);
	const [sendProgress, setSendProgress] = useState(0);
	const [recvProgress, setRecvProgress] = useState(0);
	const [link, setLink] = useState("");
	const [copied, setCopied] = useState("");
	const peerRef = useRef<Peer | null>(null);
	const receiveBuffers = useRef<ArrayBuffer[]>([]);
	const expectedChunks = useRef(0);
	const receivedBytes = useRef(0);
	const metaRef = useRef<Meta | null>(null);
	const busyRef = useRef(false);

	const chunkSize = 16 * 1024;

	const peerOptions = useMemo(
		() => ({
			debug: 0,
		}),
		[]
	);

	useEffect(() => {
		const p = new Peer(peerOptions);
		peerRef.current = p;
		setStatus("Starting…");
		p.on("open", (id) => {
			setMyId(id);
			setStatus("Ready");
			setLink(`${location.origin}${location.pathname}?peer=${id}`);
		});
		p.on("connection", (c) => {
			wireConnection(c);
		});
		p.on("error", (err) => {
			setStatus(`Error: ${String(err)}`);
		});
		return () => {
			p.destroy();
		};
	}, [peerOptions]);

	useEffect(() => {
		const url = new URL(location.href);
		const q = url.searchParams.get("peer");
		if (q) setRemoteId(q);
	}, []);

	function wireConnection(c: DataConnection) {
		setConn(c);
		setConnected(true);
		setStatus("Connected");
		c.on("data", async (d) => {
			const msg = d as IncomingMessage;
			if ((msg as Meta).type === "meta") {
				const m = msg as Meta;
				metaRef.current = m;
				expectedChunks.current = Math.ceil(m.size / m.chunkSize);
				receiveBuffers.current = [];
				receivedBytes.current = 0;
				setRecvProgress(0);
				c.send({ type: "ack", index: -1 } satisfies Ack);
			} else if ((msg as Chunk).type === "chunk") {
				const ch = msg as Chunk;
				receiveBuffers.current.push(ch.payload);
				receivedBytes.current += ch.payload.byteLength;
				if (metaRef.current) {
					const p = Math.min(
						100,
						Math.floor(
							(receivedBytes.current / metaRef.current.size) * 100
						)
					);
					setRecvProgress(p);
				}
				c.send({ type: "ack", index: ch.index } satisfies Ack);
			} else if ((msg as Eof).type === "eof") {
				const m = metaRef.current;
				if (!m) return;
				const blob = new Blob(receiveBuffers.current, { type: m.mime });
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = m.name;
				document.body.appendChild(a);
				a.click();
				a.remove();
				URL.revokeObjectURL(url);
				setStatus("Received file");
				setRecvProgress(100);
			} else if ((msg as Ack).type === "ack") {
				busyRef.current = false;
			}
		});
		c.on("close", () => {
			setConnected(false);
			setConn(null);
			setStatus("Disconnected");
		});
	}

	function connect() {
		if (!peerRef.current || !remoteId) return;
		setStatus("Connecting…");
		const c = peerRef.current.connect(remoteId, { reliable: true });
		c.on("open", () => wireConnection(c));
		c.on("error", (err) => setStatus(`Error: ${String(err)}`));
	}

	async function sendFile() {
		if (!file || !conn) return;
		setStatus("Sending…");
		setSendProgress(0);
		const m: Meta = {
			type: "meta",
			name: file.name,
			size: file.size,
			mime: file.type || "application/octet-stream",
			chunkSize,
		};
		conn.send(m);
		let offset = 0;
		let index = 0;
		while (offset < file.size) {
			const slice = file.slice(offset, offset + chunkSize);
			const buf = await slice.arrayBuffer();
			await waitForAck();
			conn.send({ type: "chunk", index, payload: buf } as Chunk);
			offset += chunkSize;
			index += 1;
			const p = Math.min(100, Math.floor((offset / file.size) * 100));
			setSendProgress(p);
		}
		await waitForAck();
		conn.send({ type: "eof" } as Eof);
		setSendProgress(100);
		setStatus("Sent");
	}

	function waitForAck() {
		return new Promise<void>((resolve) => {
			if (!conn) return resolve();
			const trySend = () => {
				if (!busyRef.current) {
					busyRef.current = true;
					resolve();
				} else {
					setTimeout(trySend, 8);
				}
			};
			trySend();
		});
	}

	function copy(text: string, label: string) {
		navigator.clipboard.writeText(text);
		setCopied(label);
		setTimeout(() => setCopied(""), 1500);
	}

	function disconnect() {
		conn?.close();
		setConn(null);
		setConnected(false);
		setStatus("Idle");
	}

	return (
		<div className="min-h-screen w-full bg-neutral-950 text-neutral-100 flex items-center justify-center p-6">
			<div className="w-full max-w-3xl grid gap-6">
				<h1 className="text-3xl font-bold">PeerJS File Share</h1>
				<div className="rounded-2xl border border-neutral-800 p-4 grid gap-3">
					<div className="flex flex-wrap items-center gap-3">
						<div className="px-3 py-2 max-sm:w-full max-sm:text-center rounded-xl bg-neutral-900 border border-neutral-800 text-sm">
							{status}
						</div>
						<div className="flex max-sm:flex-col sm:items-center gap-2 text-sm max-sm:w-full ">
							<span className="opacity-70">Your ID:</span>
							<code className="px-2 py-2 max-sm:w-full max-sm:text-center rounded-lg bg-neutral-900 border border-neutral-800 text-xs break-all">
								{myId || "…"}
							</code>
							<button
								className="px-2 py-2 max-sm:w-full max-sm:text-center rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs relative"
								onClick={() => copy(myId, "id")}
								disabled={!myId}
							>
								Copy
								{copied === "id" && (
									<span className="absolute -top-7 left-1/2 -translate-x-1/2 bg-neutral-800 px-2 py-1 rounded text-xs">
										Copied!
									</span>
								)}
							</button>
							<button
								className="px-2 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs relative"
								onClick={() => copy(link, "link")}
								disabled={!myId}
							>
								Copy Link
								{copied === "link" && (
									<span className="absolute -top-7 left-1/2 -translate-x-1/2 bg-neutral-800 px-2 py-1 rounded text-xs">
										Copied!
									</span>
								)}
							</button>
						</div>
					</div>
					<div className="grid sm:grid-cols-[1fr_auto] gap-2">
						<input
							className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 outline-none"
							placeholder="Peer ID"
							value={remoteId}
							onChange={(e) => setRemoteId(e.target.value)}
						/>
						{!connected ? (
							<button
								className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500"
								onClick={connect}
								disabled={!remoteId}
							>
								Connect
							</button>
						) : (
							<button
								className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500"
								onClick={disconnect}
							>
								Disconnect
							</button>
						)}
					</div>
				</div>

				<div className="rounded-2xl border border-neutral-800 p-4 grid gap-4">
					<div className="grid md:grid-cols-2 gap-4">
						<div className="grid gap-3">
							<h2 className="font-semibold">Send</h2>
							<input
								type="file"
								className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-neutral-800 file:text-neutral-100 "
								onChange={(e) =>
									setFile(e.target.files?.[0] || null)
								}
							/>
							<button
								className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
								onClick={sendFile}
								disabled={!connected || !file}
							>
								Send File
							</button>
							<div className="h-2 bg-neutral-900 rounded-full overflow-hidden">
								<div
									className="h-full bg-indigo-500"
									style={{ width: `${sendProgress}%` }}
								/>
							</div>
							<div className="text-xs opacity-70">
								{sendProgress}%
							</div>
						</div>

						<div className="grid gap-3">
							<h2 className="font-semibold">Receive</h2>
							<div className="h-2 bg-neutral-900 rounded-full overflow-hidden">
								<div
									className="h-full bg-emerald-500"
									style={{ width: `${recvProgress}%` }}
								/>
							</div>
							<div className="text-xs opacity-70">
								{recvProgress}%
							</div>
							<p className="text-sm opacity-80">
								Connect peers, then when a file arrives it will
								auto-download.
							</p>
						</div>
					</div>
				</div>

				<p className="text-xs opacity-60 text-center">
					Uses WebRTC data channels via PeerJS. For best results, open
					both peers over the internet or on different devices. Large
					files are chunked.
				</p>
			</div>
		</div>
	);
}
