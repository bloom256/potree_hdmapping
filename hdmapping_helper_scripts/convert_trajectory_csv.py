#!/usr/bin/env python3
"""Convert a trajectory CSV to trajectory.json for the Potree viewer.

Usage: python convert_trajectory_csv.py <trajectory.csv> [output.json]

Input CSV has no header. Columns: timestamp,x,y,z,qx,qy,qz,qw
Output is a JSON array of [x, y, z] positions (columns 1, 2, 3).
"""

import csv
import json
import os
import sys


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <trajectory.csv> [output.json]", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    if len(sys.argv) >= 3:
        output_path = sys.argv[2]
    else:
        base, _ = os.path.splitext(input_path)
        output_path = base + ".json"

    if os.path.exists(output_path):
        print(f"Output already exists, skipping: {output_path}")
        return

    positions = []
    with open(input_path, "r", newline="") as f:
        reader = csv.reader(f)
        for row_num, row in enumerate(reader, start=1):
            if len(row) < 4:
                print(f"Warning: skipping row {row_num} (too few columns)", file=sys.stderr)
                continue
            try:
                x = float(row[1])
                y = float(row[2])
                z = float(row[3])
            except (ValueError, IndexError):
                print(f"Warning: skipping row {row_num} (failed to parse floats)", file=sys.stderr)
                continue
            positions.append([x, y, z])

    with open(output_path, "w") as f:
        json.dump(positions, f, separators=(",", ":"))

    print(f"Wrote {len(positions)} positions to {output_path}")


if __name__ == "__main__":
    main()
