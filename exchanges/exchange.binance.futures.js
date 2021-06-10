frostybot_exchange_binance_base = require('./exchange.binance.base');
var context = require('express-http-context');

module.exports = class frostybot_exchange_binance_futures extends frostybot_exchange_binance_base {

    // Class constructor

    constructor(stub = undefined) {
        super(stub);        
        this.type = 'futures'                        // Exchange subtype
        this.shortname = 'binance_futures'           // Abbreviated name for this exchange
        this.description = 'Binance USD-M Futures'   // Full name for this exchange
        this.has_subaccounts = false                 // Subaccounts supported?
        this.has_testnet = true                      // Test supported?
        this.stablecoins = ['USDT','BUSD'];          // Stablecoins supported on this exchange
        this.order_sizing = 'base';                  // Exchange requires base size for orders
        this.collateral_assets = ['USDT','BUSD'];    // Assets that are used for collateral
        this.exchange_symbol = 'symbol';             // Does CCXT use the ID or the Symbol field?
        this.balances_market_map = '{currency}USDT'  // Which market to use to convert non-USD balances to USD
        this.orders_symbol_required = true;          // This exchange requires a symbol when fetching orders
        this.param_map = {                           // Order parameter mappings
            limit              : 'LIMIT',
            market             : 'MARKET',
            stop               : 'STOP',
            stop_market        : 'STOP_MARKET',
            stoploss_limit     : 'STOP',
            stoploss_market    : 'STOP_MARKET',
            takeprofit_limit   : 'TAKE_PROFIT', 
            takeprofit_market  : 'TAKE_PROFIT_MARKET',
            take_profit_limit  : 'TAKE_PROFIT', 
            take_profit_market : 'TAKE_PROFIT_MARKET',
            trailing_stop      : 'TRAILING_STOP_MARKET', 
            post               : null,                // TODO
            reduce             : 'reduceOnly',
            ioc                : null,                // TODO
            tag                : null,                // TODO
            trigger            : 'stopPrice',
        };
        this.map_mod()
    }

    // Initialize exchange

    async initialize() {

    }



    // Get CCXT Parameters

    ccxtparams() {
        var params = {
            options: {
                defaultType : 'future',
            }
        }

        if (this.stub != undefined) {
            var stub = this.stub;
            params['apiKey'] = stub.parameters.apikey;
            params['secret'] = stub.parameters.secret;
            if (String(stub.parameters.testnet) == 'true') {
                const ccxtlib = require ('ccxt');                
                const testclass = ccxtlib['binance'];
                var testobj = new testclass ();
                var urls = testobj.urls != undefined ? testobj.urls : {};
                params['urls'] = urls;
                if (urls.hasOwnProperty('test')) params.urls.api = urls.test;
            }
        }
        return ['binance', params];

    }    

    // Custom params

    async custom_params(params) {
        var [type, order_params, custom_params] = params
        /*
        if (!order_params.hasOwnProperty('params')) {
            order_params.params = {};
        }
        var position_mode = await this.ccxtobj.fapiPrivateGetPositionSideDual();
        var dual = position_mode.hasOwnProperty('dualSidePosition') ? position_mode.dualSidePosition : false;
        */
        return order_params;
    }    

    // Set leverage for symbol

    async leverage(params) {
        var [symbol, type, leverage] = this.mod.utils.extract_props(params, ['symbol', 'type', 'leverage']);
        await this.markets();
        var market = await this.get_market_by_id_or_symbol(symbol);
        symbol = market.id;
        var type = (type == 'cross' ? 'CROSSED' : (type == 'isolated' ? 'ISOLATED' : null));
        var leverage = leverage.toLowerCase().replace('x', '');
        await this.execute('fapiPrivate_post_margintype', { symbol: symbol, marginType: type});
        var leverageResult = await this.execute('fapiPrivate_post_leverage', { symbol: symbol, leverage: leverage});
        if ((leverageResult.hasOwnProperty('leverage')) && (leverageResult.leverage == leverage)) {
            return true;
        } else {
            return false;
        }
    }

    // Get list of current positions

    async positions() { 
        let raw_positions = await this.execute('fapiPrivate_get_positionrisk');
        await this.markets();
        // Get futures positions
        var positions = []; 
        if (this.mod.utils.is_array(raw_positions))
            await raw_positions
            .filter(raw_position => raw_position.positionAmt != 0)
            .forEach(async raw_position => {
                const symbol = raw_position.symbol;
//                const market = await this.mod.exchange.market('binance_futures', symbol);                
                const direction = (raw_position.positionAmt > 0 ? 'long' : (raw_position.positionAmt <  0 ? 'short' : 'flat'));
                const base_size = (raw_position.positionAmt * 1);
                const entry_price = (raw_position.entryPrice * 1);
                const liquidation_price = this.mod.utils.is_numeric(raw_position.liquidationPrice) ? (raw_position.liquidationPrice * 1) : null;
                const raw = raw_position;
                const position = new this.classes.position_futures(this.stub.uuid, this.stub.stub, 'binance_futures', symbol, direction, base_size, null, entry_price, liquidation_price, raw);
                await position.update();
                positions.push(position)
            })
        this.positions = positions;
        return this.positions;
    }

    // Get list of markets from exchange

    async markets() {
        let results = [];
        var tickers = await this.fetch_tickers();
        var raw_markets = await this.execute('fetch_markets')
        var exchange = (this.shortname != undefined ? this.shortname : (this.constructor.name).split('_').slice(2).join('_'));
        raw_markets
            .forEach(raw_market => {
                var contracttype = String(raw_market.info.hasOwnProperty('contractType') ? raw_market.info.contractType : 'perpetual').toLowerCase();
                if (contracttype == 'perpetual') {
                    const id = raw_market.id;
                    const symbol = raw_market.symbol;
                    const tvsymbol = 'BINANCE:' + raw_market.symbol.replace('-','').replace('/','');
                    const type = 'futures';
                    const base = raw_market.base;
                    const quote = raw_market.quote;
                    var ticker = tickers.hasOwnProperty(id) ? tickers[id] : null;
                    const bid = ticker != null ? parseFloat(ticker.bid) : null;
                    const ask = ticker != null ? parseFloat(ticker.ask) : null;
                    const expiration = (raw_market.expiration != null ? raw_market.expiration : null);
                    const contract_size = (raw_market.info.contractSize != null ? raw_market.info.contractSize : 1);
                    const price_filter  = this.mod.utils.filter_objects(raw_market.info.filters, {filterType: 'PRICE_FILTER'} );
                    const amount_filter = this.mod.utils.filter_objects(raw_market.info.filters, {filterType: 'LOT_SIZE'} );
                    const precision = {
                        price: (price_filter[0] != undefined ? price_filter[0].tickSize * 1 : raw_market.precision.price != undefined ? raw_market.precision.price : undefined),
                        amount: (amount_filter[0] != undefined ? amount_filter[0].stepSize * 1 : raw_market.precision.amount != undefined ? raw_market.precision.amount : undefined)
                    }
                    const raw = raw_market.info;
                    if (bid > 0 && ask > 0) {
                        const market = new this.classes.market(exchange, id, symbol, type, base, quote, bid, ask, expiration, contract_size, precision, tvsymbol, raw)
                        results.push(market);
                    }
                }
            });
        return results;
    }


    // Fetch tickers

    async fetch_tickers() {
        var results = {};
        var tickersRaw = await this.execute('fapiPublic_get_ticker_bookticker')
        for (var i = 0; i < tickersRaw.length; i++) {
            var tickerRaw = tickersRaw[i];
            var symbol = tickerRaw.symbol;
            results[symbol] = {
                bid: this.mod.utils.is_numeric(tickerRaw.bidPrice) ? tickerRaw.bidPrice * 1 : null,
                ask: this.mod.utils.is_numeric(tickerRaw.askPrice) ? tickerRaw.askPrice * 1 : null,
            }
        }
        return results;
    }

    
    // Get open orders

    async open_orders(params) {
        var [symbol, since, limit] = this.mod.utils.extract_props(params, ['symbol', 'since', 'limit']);
        await this.ccxtobj.fetch_markets(symbol)
        let raworders = await this.ccxtobj.fetch_open_orders(symbol, since, limit);
        return this.parse_orders(raworders);
    }

    // Get all order history

    async all_orders(params) {
        var [symbol, since, limit] = this.mod.utils.extract_props(params, ['symbol', 'since', 'limit']);
        await this.ccxtobj.fetch_markets(symbol)
        let raworders = await this.ccxtobj.fetch_orders(symbol, since, limit);
        return this.parse_orders(raworders);
    }

    // Cancel orders

    async cancel(params) {
        var [symbol, id] = this.mod.utils.extract_props(params, ['symbol', 'id']);
        if (['all', undefined].includes(id)) {
            var orders = await this.open_orders({symbol: symbol});
            let cancel = await this.ccxtobj.cancel_all_orders(symbol);
            orders.forEach((order, idx) => {
                order.status = 'cancelled';
                orders[idx] = order;
            })   
            return orders;
        } else {
            if (orders.id !== undefined) {
                var id = params.id;
                let order = await this.ccxtobj.cancel_order(id, symbol);
                return order;
            }
        }
        return false
    }


    // Parse CCXT order format into Frostybot order format

    parse_order(order) {
        if (order instanceof this.classes.order) {
            return order;
        }
        const symbol = order.symbol;
        const id = order.id;
        const timestamp = order.info.updateTime;
        const direction = order.side;
        const trigger = (order.info.trailValue != undefined ? (order.info.trailValue * 1) : (order.info.triggerPrice != undefined ? (order.info.triggerPrice * 1) : ( order.info.stopPrice != undefined ? (order.info.stopPrice * 1) : null)));
        const price = (order.info.orderPrice != null ? order.info.orderPrice : (order.price != null ? order.price : (trigger != null ? trigger : null)));
        const size = order.amount;
        const filled = order.filled;
        var type = order.type.toLowerCase();
        switch (type) {
            case 'stop'          :  type = (price != trigger ? 'stop_limit' : 'stop_market');
                                    break;
            case 'take_profit'   :  type = (price != trigger ? 'takeprofit_limit' : 'takeprofit_market');
                                    break;
            case 'take_profit_market'   :  type = 'takeprofit_market';
                                    break;
        }
        const status = order.status.replace('CANCELED', 'cancelled');   // Fix spelling error
        const raw = order.info;
        var uuid = this.stub.uuid == undefined ? context.get('uuid') : null
        var order = new this.classes.order( uuid, this.stub.stub, 'binance_futures', symbol, id, timestamp, type, direction, price, trigger, size, filled, status, raw);
        return order;
    }


}
