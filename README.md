# clean up wallets

psql postgresql://copytrader:copytrader_dev_password@localhost:5432/copytrader -c "DELETE FROM followed_wallets;"

# remove foreign key if lags

psql postgresql://copytrader:copytrader_dev_password@localhost:5432/copytrader -c "ALTER TABLE leader_trades DROP CONSTRAINT leader_trades_leader_wallet_fkey;"