-- 由 owner 手工执行(proposal §4「必须先堵的坑」、data-model 5.1),不在 `npm run migrate` 里。
-- 执行记录:生产 —— 未执行。2026-09-29 用应用角色核对过生产 29 行,全部满足下列规则。
-- 让 management.authentication 的坏行写不进去:quant `auth_model_to_auth` 解析失败会让整张快照被拒收。
-- 规则与 src/shared/accounts.ts 相同;v2 界面、DBeaver 与任何其他写入方都受约束。

-- `account_tags` 是 `Vec<AccountTag>` 的 serde JSON 文本:无值变体是字符串,带值变体是单键对象。
CREATE OR REPLACE FUNCTION management.valid_account_tags(tags text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  doc jsonb;
  tag jsonb;
  name text;
  value jsonb;
  seen text[] := '{}';
BEGIN
  IF tags IS NULL THEN RETURN false; END IF;
  BEGIN
    doc := tags::jsonb;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  IF jsonb_typeof(doc) <> 'array' THEN RETURN false; END IF;
  FOR tag IN SELECT jsonb_array_elements(doc) LOOP
    IF jsonb_typeof(tag) = 'string' THEN
      IF NOT (tag #>> '{}') = ANY (ARRAY['Unified', 'ReadOnly', 'Terminated', 'Initializing', 'Test',
          'LowLatencyAccount', 'AdditionalLeverageRiskLimits', 'ArbitrageAccount']) THEN
        RETURN false;
      END IF;
      CONTINUE;
    END IF;
    IF jsonb_typeof(tag) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(tag)) <> 1 THEN
      RETURN false;
    END IF;
    name := (SELECT k FROM jsonb_object_keys(tag) AS k);
    value := tag -> name;
    CASE name
      WHEN 'PortfolioGroup' THEN
        IF jsonb_typeof(value) <> 'string' THEN RETURN false; END IF;
      WHEN 'VipLevel', 'MarketMakerLevel' THEN
        IF jsonb_typeof(value) <> 'number' OR (value #>> '{}') !~ '^[0-9]{1,3}$'
           OR (value #>> '{}')::int > 255 THEN
          RETURN false;
        END IF;
      WHEN 'Client' THEN
        IF jsonb_typeof(value) <> 'object' OR jsonb_typeof(value -> 'client_name') IS DISTINCT FROM 'string' THEN
          RETURN false;
        END IF;
      WHEN 'ListingTagBlocklist' THEN
        IF jsonb_typeof(value) <> 'array' THEN RETURN false; END IF;
      WHEN 'WalletBlocked' THEN
        NULL; -- GenericWalletType 结构复杂,v2 不编辑,原样保留
      ELSE
        RETURN false;
    END CASE;
    -- 单值标签各最多一个(quant 的 portfolio_group() 只取第一个)。
    IF name IN ('PortfolioGroup', 'VipLevel', 'MarketMakerLevel', 'Client') THEN
      IF name = ANY (seen) THEN RETURN false; END IF;
      seen := seen || name;
    END IF;
  END LOOP;
  RETURN true;
END $$;

-- 无值标签的名字;JSON 不合法时为 NULL(那一行由 valid_account_tags 拒绝)。
CREATE OR REPLACE FUNCTION management.account_flags(tags text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN ARRAY(SELECT t #>> '{}' FROM jsonb_array_elements(tags::jsonb) AS t WHERE jsonb_typeof(t) = 'string');
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

-- Rust `IpAddr` 能解析的地址:IPv4 点分十进制(不带前导零)或 IPv6;不接受 CIDR 与 zone。
CREATE OR REPLACE FUNCTION management.valid_ip_whitelist(ips text[]) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  ip text;
BEGIN
  IF ips IS NULL THEN RETURN true; END IF;
  FOREACH ip IN ARRAY ips LOOP
    IF ip IS NULL THEN RETURN false; END IF;
    IF ip ~ '^[0-9.]+$' THEN
      IF ip !~ '^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$' THEN
        RETURN false;
      END IF;
    ELSIF ip ~ '^[0-9A-Fa-f:.]+$' AND position(':' IN ip) > 0 THEN
      BEGIN
        PERFORM ip::inet;
      EXCEPTION WHEN others THEN
        RETURN false;
      END;
    ELSE
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;

ALTER TABLE management.authentication
  ADD CONSTRAINT authentication_auth_id_chk CHECK (auth_id = exchange || '_' || account_name),
  ADD CONSTRAINT authentication_exchange_chk CHECK (exchange IN ('Aster', 'Binance', 'BinanceUS', 'Bitget',
    'Bithumb', 'Bybit', 'CoinEx', 'Coinbase', 'Deribit', 'Gate', 'HTX', 'Hyperliquid', 'Kalshi', 'KuCoin',
    'Lighter', 'Okx', 'Polymarket', 'Upbit', 'XT')),
  ADD CONSTRAINT authentication_account_name_chk CHECK (account_name <> '' AND account_name !~ '^\s|\s$'),
  ADD CONSTRAINT authentication_account_tags_chk CHECK (management.valid_account_tags(account_tags)),
  ADD CONSTRAINT authentication_ip_whitelist_chk CHECK (management.valid_ip_whitelist(ip_whitelist)),
  -- 非 Test 账户必须有白名单(NULL 在 quant 里表示不限制)。
  ADD CONSTRAINT authentication_live_whitelist_chk
    CHECK (coalesce(cardinality(ip_whitelist), 0) > 0 OR 'Test' = ANY (management.account_flags(account_tags))),
  ADD CONSTRAINT authentication_api_pass_chk CHECK (api_pass IS NOT NULL);
