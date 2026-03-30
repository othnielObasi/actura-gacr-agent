#!/usr/bin/env python3
"""
Kraken CLI Wrapper — provides the CLI interface expected by kraken-cli.ts
using the Kraken REST API directly.
"""
import argparse
import json
import os
import sys
import time
import hashlib
import hmac
import base64
import urllib.parse
import urllib.request

API_URL = "https://api.kraken.com"
API_KEY = os.environ.get("KRAKEN_API_KEY", "")
API_SECRET = os.environ.get("KRAKEN_API_SECRET", "")


def kraken_signature(urlpath, data):
    postdata = urllib.parse.urlencode(data)
    encoded = (str(data["nonce"]) + postdata).encode()
    message = urlpath.encode() + hashlib.sha256(encoded).digest()
    mac = hmac.new(base64.b64decode(API_SECRET), message, hashlib.sha512)
    return base64.b64encode(mac.digest()).decode()


def public_query(method, params=None):
    url = f"{API_URL}/0/public/{method}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def private_query(method, params=None):
    if not API_KEY or not API_SECRET:
        return {"error": ["EAPI:Invalid key - API key not configured"]}
    urlpath = f"/0/private/{method}"
    data = params or {}
    data["nonce"] = str(int(time.time() * 1000))
    postdata = urllib.parse.urlencode(data).encode()
    sig = kraken_signature(urlpath, data)
    req = urllib.request.Request(
        f"{API_URL}{urlpath}",
        data=postdata,
        headers={
            "API-Key": API_KEY,
            "API-Sign": sig,
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def cmd_trade(args):
    params = {
        "pair": args.pair,
        "type": args.type,
        "ordertype": args.ordertype,
        "volume": args.volume,
    }
    if args.price:
        params["price"] = args.price
    if args.price2:
        params["price2"] = args.price2
    if args.leverage:
        params["leverage"] = args.leverage
    if args.validate:
        params["validate"] = True
    if args.timeinforce:
        params["timeinforce"] = args.timeinforce
    if args.close_ordertype:
        params["close[ordertype]"] = args.close_ordertype
    if args.close_price:
        params["close[price]"] = args.close_price
    if args.close_price2:
        params["close[price2]"] = args.close_price2
    if getattr(args, "sandbox", False):
        params["validate"] = True
    return private_query("AddOrder", params)


def cmd_balance(args):
    return private_query("Balance")


def cmd_open_orders(args):
    return private_query("OpenOrders")


def cmd_trades(args):
    return private_query("TradesHistory")


def cmd_cancel(args):
    return private_query("CancelOrder", {"txid": args.txid})


def cmd_cancel_all(args):
    return private_query("CancelAll")


def cmd_mcp(args):
    init = {
        "jsonrpc": "2.0", "id": 0,
        "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "kraken-cli-mcp", "version": "1.0.0"},
        },
    }
    sys.stdout.write(json.dumps(init) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue

        req_id = req.get("id", 1)
        method = req.get("method", "")
        params = req.get("params", {})

        if method == "tools/list":
            tools = [
                {"name": "add_order", "description": "Place an order on Kraken",
                 "inputSchema": {"type": "object", "properties": {
                     "pair": {"type": "string"}, "type": {"type": "string"},
                     "ordertype": {"type": "string"}, "volume": {"type": "string"},
                     "price": {"type": "string"}, "validate": {"type": "boolean"},
                 }, "required": ["pair", "type", "ordertype", "volume"]}},
                {"name": "cancel_order", "description": "Cancel an order",
                 "inputSchema": {"type": "object", "properties": {"txid": {"type": "string"}}, "required": ["txid"]}},
                {"name": "get_balance", "description": "Get account balance",
                 "inputSchema": {"type": "object", "properties": {}}},
            ]
            resp = {"jsonrpc": "2.0", "id": req_id, "result": {"tools": tools}}
        elif method == "tools/call":
            tool_name = params.get("name", "")
            tool_args = params.get("arguments", {})
            try:
                if tool_name == "add_order":
                    op = {"pair": tool_args.get("pair", ""), "type": tool_args.get("type", "buy"),
                          "ordertype": tool_args.get("ordertype", "market"), "volume": tool_args.get("volume", "0")}
                    if tool_args.get("price"): op["price"] = tool_args["price"]
                    if tool_args.get("validate") or tool_args.get("sandbox"): op["validate"] = True
                    api_result = private_query("AddOrder", op)
                    resp = {"jsonrpc": "2.0", "id": req_id, "result": api_result.get("result", api_result)}
                elif tool_name == "cancel_order":
                    api_result = private_query("CancelOrder", {"txid": tool_args.get("txid", "")})
                    resp = {"jsonrpc": "2.0", "id": req_id, "result": api_result.get("result", api_result)}
                elif tool_name == "get_balance":
                    api_result = private_query("Balance")
                    resp = {"jsonrpc": "2.0", "id": req_id, "result": api_result.get("result", api_result)}
                else:
                    resp = {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"}}
            except Exception as e:
                resp = {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32000, "message": str(e)}}
        else:
            resp = {"jsonrpc": "2.0", "id": req_id, "result": {}}

        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser(prog="kraken", description="Kraken CLI wrapper")
    parser.add_argument("--version", action="store_true")
    parser.add_argument("--sandbox", action="store_true", default=False)
    parser.add_argument("--output", default="text")

    subparsers = parser.add_subparsers(dest="command")

    tp = subparsers.add_parser("trade")
    tp.add_argument("--pair", required=True)
    tp.add_argument("--type", required=True, choices=["buy", "sell"])
    tp.add_argument("--ordertype", required=True)
    tp.add_argument("--volume", required=True)
    tp.add_argument("--price", default=None)
    tp.add_argument("--price2", default=None)
    tp.add_argument("--leverage", default=None)
    tp.add_argument("--validate", action="store_true", default=False)
    tp.add_argument("--reduce-only", action="store_true", default=False)
    tp.add_argument("--timeinforce", default=None)
    tp.add_argument("--close-ordertype", default=None)
    tp.add_argument("--close-price", default=None)
    tp.add_argument("--close-price2", default=None)
    tp.add_argument("--sandbox", action="store_true", default=False)
    tp.add_argument("--output", default="text")

    bp = subparsers.add_parser("balance")
    bp.add_argument("--output", default="text")

    oop = subparsers.add_parser("open-orders")
    oop.add_argument("--output", default="text")

    trp = subparsers.add_parser("trades")
    trp.add_argument("--output", default="text")

    cp = subparsers.add_parser("cancel")
    cp.add_argument("--txid", required=True)
    cp.add_argument("--output", default="text")

    cap = subparsers.add_parser("cancel-all")
    cap.add_argument("--output", default="text")

    subparsers.add_parser("mcp")

    args = parser.parse_args()

    if args.version:
        print("kraken-cli-wrapper 1.0.0 (krakenex REST bridge)")
        return

    if args.command == "mcp":
        cmd_mcp(args)
        return

    commands = {
        "trade": cmd_trade, "balance": cmd_balance, "open-orders": cmd_open_orders,
        "trades": cmd_trades, "cancel": cmd_cancel, "cancel-all": cmd_cancel_all,
    }

    if not args.command:
        parser.print_help()
        sys.exit(1)

    handler = commands.get(args.command)
    if not handler:
        print(f"Unknown command: {args.command}", file=sys.stderr)
        sys.exit(1)

    try:
        if args.command == "trade" and not getattr(args, "sandbox", False) and "--sandbox" in sys.argv:
            args.sandbox = True
        result = handler(args)
        out_fmt = getattr(args, "output", "text")
        if out_fmt == "json":
            print(json.dumps(result, indent=2))
        else:
            if result.get("error"):
                print(f"Error: {result['error']}", file=sys.stderr)
                sys.exit(1)
            r = result.get("result", result)
            if isinstance(r, dict):
                for k, v in r.items():
                    print(f"{k}: {v}")
            else:
                print(r)
    except Exception as e:
        if getattr(args, "output", "text") == "json":
            print(json.dumps({"error": [str(e)]}))
        else:
            print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
