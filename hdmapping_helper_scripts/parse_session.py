#!/usr/bin/env python3
"""Extract loop closure edges from a session .mjs file.

Reads the session JSON, maps index_from/index_to to laz filenames
(basename only), and writes a compact JSON array of edges.

Usage standalone:
    python parse_session.py <session.mjs> [output.json]

Output JSON:
    [{"from": "scan_lio_403.laz", "to": "scan_lio_428.laz"}, ...]
"""

import json
import os
import sys


def parse_lc_edges(path):
    """Parse loop closure edges from a session .mjs file.

    Returns:
        list of {"from": str, "to": str}  (basenames of laz files)
    """
    with open(path, "r") as f:
        session = json.load(f)

    laz_files = session.get("laz_file_names", [])
    raw_edges = session.get("loop_closure_edges", [])

    if not laz_files:
        raise ValueError(f"No laz_file_names found in {path}")

    edges = []
    for edge in raw_edges:
        idx_from = edge["index_from"]
        idx_to = edge["index_to"]

        if idx_from >= len(laz_files) or idx_to >= len(laz_files):
            raise ValueError(
                f"Edge index out of range: {idx_from} -> {idx_to} "
                f"(only {len(laz_files)} laz files)"
            )

        name_from = os.path.basename(laz_files[idx_from]["file_name"])
        name_to = os.path.basename(laz_files[idx_to]["file_name"])
        edges.append({"from": name_from, "to": name_to})

    return edges


def edges_to_json(edges, output_path):
    """Write edges list to a JSON file."""
    with open(output_path, "w") as f:
        json.dump(edges, f, separators=(",", ":"))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <session.mjs> [output.json]", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    if len(sys.argv) >= 3:
        output_path = sys.argv[2]
    else:
        output_path = os.path.splitext(input_path)[0] + "_edges.json"

    edges = parse_lc_edges(input_path)
    edges_to_json(edges, output_path)
    print(f"Wrote {len(edges)} loop closure edges to {output_path}")
