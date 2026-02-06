#!/usr/bin/env python3
"""Convert a LAS/LAZ file to COPC using Docker PDAL.

Usage: python convert_las_to_copc.py <input.laz> [output.copc.laz]

Uses docker run pdal/pdal:2.9.0 with 1mm scale (0.001).
Skips conversion if output already exists.
"""

import os
import subprocess
import sys


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <input.laz> [output.copc.laz]", file=sys.stderr)
        sys.exit(1)

    input_path = os.path.abspath(sys.argv[1])

    if len(sys.argv) >= 3:
        output_path = os.path.abspath(sys.argv[2])
    else:
        base, ext = os.path.splitext(input_path)
        if ext.lower() in (".laz", ".las"):
            output_path = base + ".copc.laz"
        else:
            output_path = input_path + ".copc.laz"

    if os.path.exists(output_path):
        print(f"Output already exists, skipping: {output_path}")
        return

    input_dir = os.path.dirname(input_path)
    input_name = os.path.basename(input_path)
    output_name = os.path.basename(output_path)

    cmd = [
        "docker", "run", "--rm",
        "-v", f"{input_dir}:/data",
        "pdal/pdal:2.9.0",
        "pdal", "translate",
        f"/data/{input_name}",
        f"/data/{output_name}",
        "--writers.copc.forward=all",
        "--writers.copc.scale_x=0.001",
        "--writers.copc.scale_y=0.001",
        "--writers.copc.scale_z=0.001",
    ]

    print(f"Converting {input_path} -> {output_path}")
    print(f"Running: {' '.join(cmd)}")
    subprocess.run(cmd, check=True)
    print(f"Done: {output_path}")


if __name__ == "__main__":
    main()
