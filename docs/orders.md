# Orders

## Order records

An order is the record of what was bought, so it keeps the values as they were
at the time rather than reading them back off the product. Each line stores the
product's name, image and price, and an order stores the delivery address and
the coupon code that paid. A product can be renamed, discounted or deleted
afterwards and the order, the receipt and the invoice still read correctly.

`status` is one of `pending`, `cancelled`, `shipped`, `delivered`, and
`paymentMethod` is one of `razorpay`, `cod`, `wallet` (`ORDER_STATUSES` and
`PAYMENT_METHODS` in `models/orders.models.js`). The admin status form is
checked against that list before anything is written.

## Cancelling an order

An order changes state through `utils/order-transitions.js` and nowhere else, so
the question "may this order move to that state?" is answered once rather than
re-decided by each page. Every change is written by a conditional update that
names the state it is moving from, so a request that arrives twice makes the
change once and the second request gets the same answer the first one gave.

**Who may cancel.** A shopper may cancel an order or a line of it only while the
order is `pending` and only their own: an order that has been shipped, delivered
or cancelled cannot be called back, and the form is not even offered for one. An
administrator's cancellation is the same act on the same order, and goes through
the same code, so it releases the same stock and returns the same money. The
route is what makes the request an administrator's.

**Where the money goes.** Money is only given back for money that was actually
taken, and it goes back to where it came from:

| Order | What happens |
| --- | --- |
| `cod`, not paid | Nothing. No money was taken, so none is given. |
| `cod`, marked paid | Nothing. It was paid by hand on delivery; there is nothing to trace. |
| `razorpay`, not paid | Nothing. Refunding it would pay the shopper for an order they did not buy. |
| `razorpay`, paid | A refund through the gateway to the card that was charged, after the payment is read back to confirm it was captured. |
| `wallet`, paid | A credit to the balance it came out of, through the ledger entry keyed by the order. |

A card payment is not also credited to the balance, which would pay the shopper
twice for the same order.

**Once.** Each refund is claimed on the order before any money moves, and each
line carries its own claim because a line cancelled on its own is a refund of its
own share. Stock is returned under the same kind of claim, per line, so a line
that has already been called back is not returned again when the rest of the
order is. A refund the gateway refuses is recorded as `failed` with the reason
rather than reported as a failed cancellation: the order is cancelled either
way, and the refund can be asked for again.

**Lines.** Cancelling one line returns that line's share of what was paid, takes
it off the order's total, and returns only that line's stock. The share is
measured against the lines still in the order, so the last line out leaves
nothing behind. When the last line leaves, the order is cancelled and its total
is zero.

## Orders written by earlier versions

Earlier versions wrote `Pending`, `Cancelled`, `Shipped`, `Delivered`,
`completed` and `stock-unavailable`, kept a second copy of the buyer inside
`address.user`, and left `couponCode` null. Those records stay in the database
and stay readable:

- **Reading an old status.** `normaliseOrderStatus()` in
  `models/orders.models.js` maps every old word onto the four current ones, and
  anything unrecognised reads as `pending`. Every page and every decision that
  asks whether an order is still open goes through it, so nothing needs to know
  the history of the field. Nothing needs to be rewritten.
- **Reading an old buyer.** The buyer is read from the order's `user`
  reference and populated at the point of use, so the name and email shown are
  the account's own and current ones. The stale copy under `address.user` is
  ignored, and is no longer written.
- **Writing.** `status` and `paymentMethod` are enums, so a new record can only
  hold the current words. Legacy values already in the database still load
  (reading is not validated) and are re-saved in the current spelling the next
  time that order changes.
- **Cancelling an old order.** An order written before the refund note existed
  has no note, so "nothing refunded yet" means both "says `none`" and "says
  nothing". The same is true of the stock marker, so an old order can still be
  cancelled and its stock returned exactly once.

To rewrite the old words in place, without the read path:

```js
db.orders.updateMany({ status: "Delivered" }, { $set: { status: "delivered" } });
db.orders.updateMany({ status: "Cancelled" }, { $set: { status: "cancelled" } });
db.orders.updateMany({ status: "Pending" }, { $set: { status: "pending" } });
db.orders.updateMany({ status: "stock-unavailable" }, { $set: { status: "cancelled" } });
```

The old `address.user` copy and the `totalProductsBuyed`/`totalAmoutSpended`
counters on the user are left where they are; nothing reads them, so they can
be removed at any time with `db.orders.updateMany({}, { $unset: { "address.user": "" } })`.
