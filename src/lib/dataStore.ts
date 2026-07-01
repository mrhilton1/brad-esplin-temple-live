type CollectionName =
  | "crm_contacts"
  | "events"
  | "crm_sync_conflicts"
  | "crm_never_rules"
  | "text_templates"
  | "import_batches";

type Ref = {
  collectionName: CollectionName;
  id?: string;
};

type Filter = {
  field: string;
  op: "==";
  value: unknown;
};

type QueryRef = Ref & {
  filters: Filter[];
};

type SnapshotDoc = {
  id: string;
  data: () => Record<string, any>;
  exists: () => boolean;
};

type QuerySnapshot = {
  docs: SnapshotDoc[];
  size: number;
  forEach: (callback: (doc: SnapshotDoc) => void) => void;
};

export const db = {};

export function collection(_db: unknown, collectionName: CollectionName): Ref {
  return { collectionName };
}

export function doc(parent: Ref | unknown, collectionNameOrId?: CollectionName | string, maybeId?: string): Ref {
  if (isRef(parent) && maybeId === undefined) {
    return {
      collectionName: parent.collectionName,
      id: collectionNameOrId || crypto.randomUUID(),
    };
  }

  return {
    collectionName: collectionNameOrId as CollectionName,
    id: maybeId || crypto.randomUUID(),
  };
}

export function where(field: string, op: "==", value: unknown): Filter {
  return { field, op, value };
}

export function query(ref: Ref, ...filters: Filter[]): QueryRef {
  return { ...ref, filters };
}

export function serverTimestamp(): string {
  return new Date().toISOString();
}

export async function getDocs(ref: Ref | QueryRef): Promise<QuerySnapshot> {
  const filters = "filters" in ref ? ref.filters : [];
  const params = new URLSearchParams();
  for (const filter of filters) {
    if (filter.op === "==") {
      params.append(filter.field, String(filter.value));
    }
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  const docs = await request<Record<string, any>[]>(`/api/db/${ref.collectionName}${suffix}`);
  return makeQuerySnapshot(docs);
}

export async function getDoc(ref: Ref): Promise<SnapshotDoc> {
  if (!ref.id) {
    throw new Error("Document id is required.");
  }

  const data = await request<Record<string, any> | null>(`/api/db/${ref.collectionName}/${encodeURIComponent(ref.id)}`);
  return makeSnapshotDoc(ref.id, data || {}, !!data);
}

export async function setDoc(ref: Ref, data: Record<string, any>, options?: { merge?: boolean }): Promise<void> {
  if (!ref.id) {
    throw new Error("Document id is required.");
  }

  await request(`/api/db/${ref.collectionName}/${encodeURIComponent(ref.id)}`, {
    method: options?.merge ? "PATCH" : "PUT",
    body: JSON.stringify(data),
  });
}

export async function updateDoc(ref: Ref, data: Record<string, any>): Promise<void> {
  if (!ref.id) {
    throw new Error("Document id is required.");
  }

  await request(`/api/db/${ref.collectionName}/${encodeURIComponent(ref.id)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteDoc(ref: Ref): Promise<void> {
  if (!ref.id) {
    throw new Error("Document id is required.");
  }

  await request(`/api/db/${ref.collectionName}/${encodeURIComponent(ref.id)}`, {
    method: "DELETE",
  });
}

export function onSnapshot(
  ref: Ref | QueryRef,
  next: (snapshot: QuerySnapshot) => void,
  error?: (err: unknown) => void,
): () => void {
  let cancelled = false;

  const load = async () => {
    try {
      const snapshot = await getDocs(ref);
      if (!cancelled) {
        next(snapshot);
      }
    } catch (err) {
      if (!cancelled) {
        error?.(err);
      }
    }
  };

  load();
  const interval = window.setInterval(load, 5000);

  return () => {
    cancelled = true;
    window.clearInterval(interval);
  };
}

function makeQuerySnapshot(rows: Record<string, any>[]): QuerySnapshot {
  const docs = rows.map((row) => makeSnapshotDoc(row.id, row, true));
  return {
    docs,
    size: docs.length,
    forEach(callback) {
      docs.forEach(callback);
    },
  };
}

function makeSnapshotDoc(id: string, data: Record<string, any>, exists: boolean): SnapshotDoc {
  return {
    id,
    data: () => data,
    exists: () => exists,
  };
}

function isRef(value: unknown): value is Ref {
  return !!value && typeof value === "object" && "collectionName" in value;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const adminToken = typeof window !== "undefined"
    ? window.localStorage.getItem("temple_admin_token") || ""
    : "";

  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(adminToken ? { "X-Admin-Token": adminToken } : {}),
      ...init?.headers,
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }

  return payload as T;
}
